// Scraper del preview público de un canal de Telegram.
//
// Telegram expone los mensajes de cualquier canal PÚBLICO en
// https://t.me/s/<channel>. Es HTML estático, no requiere login, bot ni
// session. Para traer mensajes viejos paginamos con ?before=<id>, que
// devuelve los ~20 mensajes inmediatamente más viejos que ese id.
//
// Este script corre desde GitHub Actions, pagina hacia atrás hasta
// llegar a SINCE_DATE (default 2026-05-25), parsea cada mensaje en uno
// o varios bundles, y commitea todo de una sola pasada al JSON
// nintendo-bundles.json usando el GITHUB_TOKEN built-in del runner.

const CHANNEL = process.env.TG_CHANNEL || "swichtaccount";
const TG_BASE = `https://t.me/s/${CHANNEL}`;
const FILE = "nintendo-bundles.json";
const GITHUB_API = "https://api.github.com";

const SINCE_DATE = new Date(process.env.SINCE_DATE || "2026-05-25T00:00:00Z");
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "100", 10);

async function main() {
  console.log(`[scrape] Canal: @${CHANNEL}`);
  console.log(`[scrape] Fecha de corte: ${SINCE_DATE.toISOString()} (todo lo posterior se incluye)`);

  const { messages: allMessages, complete } = await fetchAllMessages();
  console.log(`[scrape] Total de mensajes recolectados desde el corte: ${allMessages.length}`);
  console.log(`[scrape] Escaneo ${complete ? "COMPLETO" : "PARCIAL"} (complete=${complete}) — el prune solo corre si está completo.`);

  const bundles = [];
  for (const msg of allMessages) {
    const blocks = msg.text.split(/(?=NINTENDO SWITCH ACCOUNT)/i);
    for (const block of blocks) {
      const b = parseBundle(block);
      if (b) {
        b._postedAt = msg.date;  // transient, para ordenar; no se commitea
        if (msg.date instanceof Date && !isNaN(msg.date)) {
          b.date = msg.date.toISOString();
        }
        bundles.push(b);
      }
    }
  }

  // Deduplicar por id quedándonos con la versión más reciente
  // (si el proveedor reposteó el mismo id con cambios).
  const byId = new Map();
  for (const b of bundles) {
    const prev = byId.get(b.id);
    if (!prev || (b._postedAt && prev._postedAt && b._postedAt > prev._postedAt)) {
      byId.set(b.id, b);
    }
  }
  const deduped = Array.from(byId.values())
    .sort((a, b) => (b._postedAt || 0) - (a._postedAt || 0));  // newest first

  console.log(`[scrape] Bundles únicos parseados: ${deduped.length}`);
  if (deduped.length === 0) {
    console.log("[scrape] Nada para commitear. Saliendo.");
    return;
  }

  const stats = await batchUpsert(deduped, complete);
  console.log(`[scrape] Resumen: ${JSON.stringify(stats)}`);
}

// ===== Paginación =====
// Devuelve { messages, complete }. `complete` es true SOLO si recorrimos
// limpiamente toda la ventana (llegamos a SINCE_DATE, o se acabaron los
// mensajes del canal después de al menos una página válida). Cualquier
// corte por error HTTP, falta de progreso o MAX_PAGES deja complete=false,
// porque en ese caso NO tenemos una vista confiable del canal y borrar
// bundles sería peligroso (podríamos eliminar cosas que sí siguen vivas).
async function fetchAllMessages() {
  const all = [];
  let beforeId = null;
  let page = 0;
  let crossedCutoff = false;
  let complete = false;

  while (page < MAX_PAGES && !crossedCutoff) {
    const url = beforeId ? `${TG_BASE}?before=${beforeId}` : TG_BASE;
    console.log(`[scrape] Page ${page + 1}: GET ${url}`);

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
      },
    });
    if (!r.ok) {
      console.error(`[scrape] HTTP ${r.status} en ${url} — corto la paginación (escaneo PARCIAL).`);
      break;
    }
    const html = await r.text();
    const messages = extractMessages(html);
    if (messages.length === 0) {
      // Página vacía después de haber traído mensajes = se acabó el canal,
      // recorrimos todo. Página vacía en el primer intento = algo falló.
      if (page > 0) {
        complete = true;
        console.log(`[scrape] Page sin mensajes, llegamos al final del canal. Escaneo COMPLETO.`);
      } else {
        console.error(`[scrape] Primera página sin mensajes — el preview no cargó (escaneo PARCIAL).`);
      }
      break;
    }

    let kept = 0;
    let oldestThisPage = Infinity;
    for (const msg of messages) {
      if (msg.id < oldestThisPage) oldestThisPage = msg.id;
      if (msg.date && msg.date < SINCE_DATE) {
        crossedCutoff = true;
        continue;
      }
      all.push(msg);
      kept++;
    }
    console.log(`[scrape]   ${messages.length} mensajes en la página, ${kept} dentro del rango`);

    if (crossedCutoff) {
      complete = true;
      console.log(`[scrape] Llegamos a la fecha de corte. Escaneo COMPLETO.`);
      break;
    }
    if (oldestThisPage === Infinity || oldestThisPage === beforeId) {
      console.log(`[scrape] Sin progreso en paginación, corto (escaneo PARCIAL).`);
      break;
    }
    beforeId = oldestThisPage;
    page++;
  }

  if (page >= MAX_PAGES) {
    console.warn(`[scrape] Alcanzado MAX_PAGES=${MAX_PAGES}, puede haber mensajes más viejos sin scrapear (escaneo PARCIAL).`);
  }
  return { messages: all, complete };
}

// ===== HTML scraping =====
function extractMessages(html) {
  // Cada mensaje tiene data-post="channel/<id>". Localizamos esas marcas
  // y para cada una sacamos el slice de HTML hasta la siguiente. Dentro
  // de cada slice buscamos el <time datetime="..."> y el div con la
  // clase tgme_widget_message_text para el contenido.
  const idRe = /data-post="[^"\/]+\/(\d+)"/g;
  const positions = [];
  let m;
  while ((m = idRe.exec(html)) !== null) {
    positions.push({ id: parseInt(m[1], 10), start: m.index });
  }

  const out = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = i + 1 < positions.length ? positions[i + 1].start : html.length;
    const slice = html.slice(start, end);

    const dateMatch = slice.match(/<time[^>]*datetime="([^"]+)"/);
    const textMatch = slice.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue;

    const text = htmlToText(textMatch[1]);
    if (!text) continue;

    out.push({
      id: positions[i].id,
      date: dateMatch ? new Date(dateMatch[1]) : null,
      text,
    });
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
// colones. El "€" del proveedor NO es una moneda real: es la tabla de
// precios del negocio donde 1€ del post = ₡1.000 (45€ → ₡45.000).
// Configurable vía PRICE_MULTIPLIER.
function parsePrice(text) {
  const eurMatch = text.match(/([\d.,]+)\s*€/)
    || text.match(/€\s*([\d.,]+)/)
    || text.match(/([\d.,]+)\s*EUR(?![A-Z])/)
    || text.match(/([\d.,]+)\s*euros?(?![a-z])/i);
  if (eurMatch) {
    const eur = parseLocalNumber(eurMatch[1]);
    const mult = parseFloat(process.env.PRICE_MULTIPLIER || "1000");
    return { eur, crc: Math.round(eur * mult) };
  }

  const crcMatch = text.match(/(?:₡|colones?|crc)[\s:]*([\d.,]+)/i)
    || text.match(/precio[:\s]+([\d.,]+)/i);
  if (crcMatch) {
    return { eur: null, crc: Math.round(parseLocalNumber(crcMatch[1])) };
  }

  return { eur: null, crc: 0 };
}

function parseLocalNumber(s) {
  if (!s) return 0;
  const cleaned = String(s).trim();
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized;
  if (hasComma && hasDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (hasComma) normalized = cleaned.replace(",", ".");
  else normalized = cleaned.replace(/\./g, "");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseGames(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const cleaned = raw.replace(/[︀-️‍]/g, "");
    const line = cleaned.trim();
    if (!/^[-*•·▪►▫◾◽■□●○◦‣⁃]/.test(line)) continue;
    const content = line.replace(/^[-*•·▪►▫◾◽■□●○◦‣⁃]\s*/, "");
    // Filtramos líneas de metadata (precio, tamaño, id, etc.) que en
    // ciertas formaciones del HTML quedan pegadas al bloque de juegos.
    if (/^(precio|tama[ñn]o|total|id|c[oó]digo|para\s+compras|tg[\s:]|tel[eé]fono)\b/i.test(content)) continue;
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

// ===== GitHub commit (batch — un solo PUT) =====
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

  // La Contents API solo devuelve `content` (base64) si el archivo pesa
  // <1 MB. Para archivos más grandes viene vacío y hay que bajarlo
  // del download_url crudo.
  let rawText;
  if (meta.content && meta.encoding === "base64") {
    rawText = Buffer.from(meta.content, "base64").toString("utf8");
  } else if (meta.download_url) {
    const rr = await fetch(meta.download_url, { headers: ghHeaders() });
    if (!rr.ok) throw new Error(`GitHub raw GET ${rr.status}: ${(await rr.text()).slice(0, 200)}`);
    rawText = await rr.text();
  } else {
    throw new Error(`Contents API no devolvió content ni download_url para ${FILE}`);
  }

  const content = JSON.parse(rawText);
  return { sha: meta.sha, content };
}

function bundlesEqual(a, b) {
  // Comparación ignorando coverUrl (que se preserva manual), _postedAt
  // (transient, no se commitea) y date (no queremos retriggerear update
  // solo porque el bundle viejo no tiene date guardada todavía).
  const norm = b => {
    const { coverUrl, _postedAt, date, ...rest } = b;
    return rest;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

async function batchUpsert(scrapedBundles, scanComplete) {
  const stats = { added: 0, updated: 0, unchanged: 0, kept: 0, removed: 0, dateBackfilled: 0 };

  // PRUNE: borrar bundles que ya no están en el canal. Activado por defecto.
  // Ponelo en "0" para volver al comportamiento histórico (nunca borrar).
  const pruneEnabled = (process.env.PRUNE || "1") !== "0";
  // Tope de seguridad: si el prune intentara borrar más de este % de los
  // bundles que están dentro de la ventana, se aborta el borrado y solo se
  // hace upsert. Protege contra un preview de Telegram caído/recortado que
  // pasó los chequeos pero igual nos devolvió pocos mensajes.
  const pruneMaxRatio = parseFloat(process.env.PRUNE_MAX_RATIO || "0.5");

  const { sha, content } = await getFile();
  const existing = Array.isArray(content.bundles) ? content.bundles : [];
  const existingById = new Map(existing.map(b => [b.id, b]));

  // Un bundle está "dentro de la ventana" escaneada si tiene fecha y esa
  // fecha es >= SINCE_DATE. Solo esos son candidatos a prune: de los más
  // viejos (o sin fecha) no tenemos información en este scrape, así que se
  // conservan siempre.
  const inWindow = b => b && b.date && new Date(b.date) >= SINCE_DATE;

  const finalList = [];
  const seen = new Set();

  for (const scraped of scrapedBundles) {
    const { _postedAt, ...clean } = scraped;
    const prev = existingById.get(scraped.id);
    if (prev) {
      if (bundlesEqual(prev, clean)) {
        // Si el viejo no tiene date pero el scrape sí, la inyectamos
        // sin contar como "update" (no es un cambio de contenido).
        if (!prev.date && clean.date) {
          finalList.push({ ...prev, date: clean.date });
          stats.dateBackfilled++;
        } else {
          finalList.push(prev);
          stats.unchanged++;
        }
      } else {
        finalList.push({
          ...clean,
          coverUrl: prev.coverUrl || clean.coverUrl,
          date: clean.date || prev.date,
        });
        stats.updated++;
      }
    } else {
      finalList.push(clean);
      stats.added++;
    }
    seen.add(scraped.id);
  }

  // Bundles existentes que NO aparecieron en el scrape de esta corrida.
  const missing = existing.filter(old => !seen.has(old.id));
  // Candidatos a borrar: solo los que caen dentro de la ventana escaneada.
  const prunable = missing.filter(inWindow);
  const inWindowExisting = existing.filter(inWindow).length;

  // ¿El prune es seguro? Requiere: feature activado, escaneo COMPLETO y que
  // no estemos borrando una fracción sospechosamente grande de la ventana.
  let doPrune = pruneEnabled && scanComplete && prunable.length > 0;
  if (doPrune && inWindowExisting > 0 && prunable.length / inWindowExisting > pruneMaxRatio) {
    doPrune = false;
    console.warn(`[scrape] PRUNE ABORTADO por seguridad: intentaría borrar ${prunable.length}/${inWindowExisting} bundles de la ventana (> ${pruneMaxRatio * 100}%). Se conservan.`);
  }

  const prunableIds = new Set(prunable.map(b => b.id));
  for (const old of missing) {
    if (doPrune && prunableIds.has(old.id)) {
      stats.removed++;
      console.log(`[scrape]   removed ${old.id} (ya no está en el canal)`);
    } else {
      finalList.push(old);
      stats.kept++;
    }
  }

  // Si no hay cambios reales, no commiteamos nada.
  if (stats.added === 0 && stats.updated === 0 && stats.removed === 0 && stats.dateBackfilled === 0) {
    console.log(`[scrape] Sin cambios respecto al JSON actual. No commit.`);
    return stats;
  }

  content.bundles = finalList;
  const message = (stats.added || stats.updated || stats.removed)
    ? `chore(bundles): sync ${stats.added} new, ${stats.updated} updated, ${stats.removed} removed (${stats.unchanged} unchanged, ${stats.kept} kept) via telegram scraper`
    : `chore(bundles): backfill date en ${stats.dateBackfilled} bundles via telegram scraper`;
  const body = {
    message,
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
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);

  return stats;
}

main().catch(err => {
  console.error("[scrape] Fatal:", err.message);
  process.exit(1);
});
