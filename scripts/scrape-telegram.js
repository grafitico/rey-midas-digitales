// Scraper del preview público de un canal de Telegram.
//
// Telegram expone los mensajes de cualquier canal PÚBLICO en
// https://t.me/s/<channel>. Es HTML estático, no requiere login,
// bot, ni session — lo único que necesitamos es que el canal esté
// configurado como público.
//
// Este script corre desde GitHub Actions una vez por día (o el horario
// que tenga el workflow), parsea los últimos mensajes del canal y
// commitea cada bundle nuevo/actualizado a nintendo-bundles.json
// usando el GITHUB_TOKEN built-in del runner.

const CHANNEL = process.env.TG_CHANNEL || "swichtaccount";
const TG_URL = `https://t.me/s/${CHANNEL}`;
const FILE = "nintendo-bundles.json";
const GITHUB_API = "https://api.github.com";

async function main() {
  console.log(`[scrape] Fetching ${TG_URL}…`);
  const r = await fetch(TG_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} al leer ${TG_URL}`);
  const html = await r.text();

  const messages = extractMessages(html);
  console.log(`[scrape] Mensajes detectados en HTML: ${messages.length}`);

  const bundles = [];
  for (const text of messages) {
    // Un mismo mensaje puede contener varios bundles consecutivos.
    // Cada bundle empieza con "NINTENDO SWITCH ACCOUNT". Si el mensaje no
    // tiene ese header (formato distinto), el split devuelve un solo
    // bloque y parseBundle igual lo procesa entero.
    const blocks = text.split(/(?=NINTENDO SWITCH ACCOUNT)/i);
    for (const block of blocks) {
      const b = parseBundle(block);
      if (b) bundles.push(b);
    }
  }
  console.log(`[scrape] Bundles parseados: ${bundles.length}`);

  if (bundles.length === 0) {
    console.log("[scrape] Nada para commitear. Saliendo.");
    return;
  }

  const stats = { added: 0, updated: 0, unchanged: 0, failed: 0 };
  for (const b of bundles) {
    try {
      const result = await upsertBundle(b);
      stats[result.action] = (stats[result.action] || 0) + 1;
      console.log(`[scrape]   ${result.action} ${b.id} (₡${b.priceCRC}, ${b.games.length} juegos)`);
    } catch (e) {
      stats.failed++;
      console.error(`[scrape]   FAIL ${b.id}: ${e.message}`);
    }
  }
  console.log(`[scrape] Resumen: ${JSON.stringify(stats)}`);
}

// ===== HTML scraping =====
function extractMessages(html) {
  // El preview de t.me/s/<channel> mete cada mensaje en un div con
  // class "tgme_widget_message_text" (a veces con sufijos). Sacamos
  // el contenido y lo limpiamos a texto plano.
  const out = [];
  const re = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = htmlToText(m[1]);
    if (text) out.push(text);
  }
  return out;
}

function htmlToText(s) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ===== Parser de bundles =====
// Formato del proveedor (@swichtaccount):
//   NINTENDO SWITCH ACCOUNT 🎮
//   📝 ID: 896632
//   🎯 Juegos incluidos:
//   ▫️ LEGO Marvel Super Heroes 2 (10.9 gb)
//   ...
//   💰 Precio: 14€
//   📦 Tamaño total: 12.4gb
function parseBundle(text) {
  if (!text || typeof text !== "string") return null;

  const id = matchOne(text, [
    /ID[:\s#]*([A-Z0-9]{4,12})/i,
    /C[oó]digo[:\s#]*([A-Z0-9]{4,12})/i,
    /\b([0-9]{6,10})\b/,
    /\b([A-Z0-9]{6})\b/,
  ]);
  if (!id) return null;

  const price = parsePrice(text);
  const totalSize = matchOne(text, [
    /Tama[ñn]o(?:\s+total)?[:\s]+([\d.,]+\s*[gmGM][bB])/i,
    /Total[:\s]+([\d.,]+\s*[gmGM][bB])/i,
  ]) || "";

  const games = parseGames(text);
  if (!games.length) return null;

  const bundle = {
    id: String(id).toUpperCase(),
    priceCRC: price.crc,
    coverUrl: "",
    totalSize: totalSize.toLowerCase().replace(/\s+/g, ""),
    games,
  };
  if (price.eur != null) bundle.priceEUR = price.eur;
  return bundle;
}

function matchOne(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// Devuelve { crc, eur } — eur puede ser null si la fuente ya estaba en
// colones. Para euros se convierte usando EUR_TO_CRC_RATE (default 620).
function parsePrice(text) {
  // OJO con \b después de € — € no es char de palabra, así que el
  // word-boundary nunca matchea contra newline/end. Usamos lookahead
  // explícito en su lugar.
  const eurMatch = text.match(/([\d.,]+)\s*€/)
    || text.match(/€\s*([\d.,]+)/)
    || text.match(/([\d.,]+)\s*EUR(?![A-Z])/)
    || text.match(/([\d.,]+)\s*euros?(?![a-z])/i);
  if (eurMatch) {
    const eur = parseLocalNumber(eurMatch[1]);
    const rate = parseFloat(process.env.EUR_TO_CRC_RATE || "620");
    return { eur, crc: Math.round(eur * rate) };
  }

  const crcMatch = text.match(/(?:₡|colones?|crc)[\s:]*([\d.,]+)/i)
    || text.match(/precio[:\s]+([\d.,]+)/i);
  if (crcMatch) {
    return { eur: null, crc: Math.round(parseLocalNumber(crcMatch[1])) };
  }

  return { eur: null, crc: 0 };
}

// Parser numérico tolerante con formato europeo/CR:
//   "14"        -> 14
//   "20.000"    -> 20000   (punto como separador de miles)
//   "14,50"     -> 14.5    (coma como decimal)
//   "1.234,56"  -> 1234.56
function parseLocalNumber(s) {
  if (!s) return 0;
  const cleaned = String(s).trim();
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else {
    // Solo puntos: tratar como separador de miles (caso CRC y EUR enteros).
    normalized = cleaned.replace(/\./g, "");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseGames(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    // Stripeamos selectores de variación y zero-width joiners que suelen
    // venir pegados al emoji del bullet (ej "▫" + U+FE0F).
    const cleaned = raw.replace(/[︀-️‍]/g, "");
    const line = cleaned.trim();
    if (!/^[-*•·▪►▫◾◽■□●○◦‣⁃]/.test(line)) continue;
    const content = line.replace(/^[-*•·▪►▫◾◽■□●○◦‣⁃]\s*/, "");
    const sizeMatch = content.match(/[\(\[]?\s*([\d.,]+\s*[gmGM][bB])\s*[\)\]]?\s*$/);
    let name = content;
    let size = "";
    if (sizeMatch) {
      size = sizeMatch[1].toLowerCase().replace(/\s+/g, " ").trim();
      name = content.slice(0, sizeMatch.index).replace(/[\s\-–—]+$/, "").trim();
    }
    if (name) out.push({ name, size });
  }
  return out;
}

// ===== GitHub commit (Contents API) =====
function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en el entorno");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rey-midas-scraper",
  };
}

function ghRepo() {
  const r = process.env.GITHUB_REPO;
  if (!r) throw new Error("Falta GITHUB_REPO en el entorno");
  return r;
}

function ghBranch() {
  return process.env.GITHUB_BRANCH || "main";
}

async function getFile() {
  const url = `${GITHUB_API}/repos/${ghRepo()}/contents/${FILE}?ref=${encodeURIComponent(ghBranch())}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const meta = await r.json();
  const content = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
  return { sha: meta.sha, content };
}

function bundlesEqual(a, b) {
  return JSON.stringify({ ...a, coverUrl: "" }) === JSON.stringify({ ...b, coverUrl: "" });
}

async function upsertBundle(bundle) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, content } = await getFile();
    const bundles = Array.isArray(content.bundles) ? content.bundles : [];
    const idx = bundles.findIndex(b => b.id === bundle.id);

    let action;
    if (idx >= 0) {
      if (bundlesEqual(bundles[idx], bundle)) {
        return { action: "unchanged" };
      }
      bundles[idx] = { ...bundle, coverUrl: bundles[idx].coverUrl || bundle.coverUrl };
      action = "updated";
    } else {
      bundles.unshift(bundle);
      action = "added";
    }
    content.bundles = bundles;

    const body = {
      message: `chore(bundles): ${action} ${bundle.id} via telegram scraper`,
      content: Buffer.from(JSON.stringify(content, null, 2) + "\n", "utf8").toString("base64"),
      sha,
      branch: ghBranch(),
    };
    const url = `${GITHUB_API}/repos/${ghRepo()}/contents/${FILE}`;
    const r = await fetch(url, {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return { action };
    if (r.status === 409 || r.status === 422) {
      // SHA stale (otro commit en el medio). Releer y reintentar.
      continue;
    }
    throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("Conflicto de SHA persistente tras 3 intentos");
}

main().catch(err => {
  console.error("[scrape] Fatal:", err.message);
  process.exit(1);
});
