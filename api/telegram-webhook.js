// Webhook de Telegram para sincronizar bundles de Nintendo en tiempo real.
//
// Telegram hace POST a este endpoint cada vez que se publica un mensaje en
// el canal donde nuestro bot es administrador. Parseamos el texto del
// mensaje en un objeto bundle y commiteamos `nintendo-bundles.json` en
// GitHub vía la REST API. Vercel detecta el push y redespliega
// automáticamente, dejando el JSON nuevo disponible para el frontend.
//
// Limitación importante: para que un bot pueda LEER channel_posts, debe
// estar agregado como administrador del canal. El dueño del canal tiene
// que hacer ese paso una sola vez.
//
// Variables de entorno requeridas (Vercel → Settings → Environment):
//   TELEGRAM_BOT_TOKEN       — token que da @BotFather
//   TELEGRAM_WEBHOOK_SECRET  — string aleatorio largo; se valida via header
//   TELEGRAM_CHANNEL_ID      — opcional, para filtrar updates de otros chats
//   GITHUB_TOKEN             — PAT con scope `repo` (contents: write)
//   GITHUB_REPO              — ej "grafitico/rey-midas-digitales"
//   GITHUB_BRANCH            — opcional, default "main"

const JSON_PATH = "nintendo-bundles.json";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const received = req.headers["x-telegram-bot-api-secret-token"];
  if (!expected || received !== expected) {
    return res.status(401).json({ ok: false, error: "bad secret" });
  }

  let update;
  try {
    update = typeof req.body === "object" && req.body
      ? req.body
      : JSON.parse(await readRaw(req));
  } catch {
    return res.status(400).json({ ok: false, error: "invalid json" });
  }

  const post = update.channel_post || update.edited_channel_post;
  if (!post) return res.status(200).json({ ok: true, ignored: "not a channel post" });

  const allowed = process.env.TELEGRAM_CHANNEL_ID;
  if (allowed && String(post.chat?.id) !== String(allowed)) {
    return res.status(200).json({ ok: true, ignored: "other channel" });
  }

  const text = post.text || post.caption || "";
  const bundle = parseBundle(text);
  if (!bundle) return res.status(200).json({ ok: true, ignored: "no bundle parsed" });

  try {
    const result = await upsertBundleInGithub(bundle);
    return res.status(200).json({ ok: true, bundleId: bundle.id, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ===== Parser de mensajes =====
// Formato esperado (ajustar regex si el proveedor cambia el template):
//
//   ID: 08DN81
//   Precio: ₡20.000
//   Tamaño: 110.0gb
//   Juegos:
//   - Mortal Kombat 1 (48.0 gb)
//   - Mortal Kombat 11 (42.9 gb)
//
// El parser es tolerante: detecta el id por patrón alfanumérico de 6
// chars en mayúsculas, el precio buscando ₡ o "colones", y los juegos
// como líneas que empiezan con guión/asterisco/bullet. Si la línea
// trae "(X gb)" al final lo extrae como `size`.

export function parseBundle(text) {
  if (!text || typeof text !== "string") return null;

  const id = matchOne(text, [
    /ID[:\s#]*([A-Z0-9]{4,8})/i,
    /C[oó]digo[:\s#]*([A-Z0-9]{4,8})/i,
    /\b([A-Z0-9]{6})\b/,
  ]);
  if (!id) return null;

  const priceCRC = parsePrice(text);

  const totalSize = matchOne(text, [
    /Tama[ñn]o[:\s]+([\d.,]+\s*[gmGM][bB])/,
    /Total[:\s]+([\d.,]+\s*[gmGM][bB])/,
  ]) || "";

  const games = parseGames(text);
  if (!games.length) return null;

  return {
    id: id.toUpperCase(),
    priceCRC: priceCRC || 0,
    coverUrl: "",
    totalSize: totalSize.toLowerCase().replace(/\s+/g, ""),
    games,
  };
}

function matchOne(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parsePrice(text) {
  const m = text.match(/(?:₡|colones?|crc)[\s:]*([\d.,]+)/i)
    || text.match(/precio[:\s]+([\d.,]+)/i);
  if (!m) return 0;
  const digits = m[1].replace(/[.,\s]/g, "");
  return parseInt(digits, 10) || 0;
}

function parseGames(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!/^[-*•·▪►]/.test(line)) continue;
    const content = line.replace(/^[-*•·▪►]\s*/, "");
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

// ===== GitHub commit =====
async function upsertBundleInGithub(bundle) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) {
    throw new Error("Faltan GITHUB_TOKEN o GITHUB_REPO en env");
  }

  const apiBase = `https://api.github.com/repos/${repo}/contents/${JSON_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rey-midas-telegram-webhook",
  };

  const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!getRes.ok) {
    const t = await getRes.text();
    throw new Error(`GitHub GET ${getRes.status}: ${t.slice(0, 200)}`);
  }
  const fileMeta = await getRes.json();
  const current = JSON.parse(Buffer.from(fileMeta.content, "base64").toString("utf8"));

  const bundles = Array.isArray(current.bundles) ? current.bundles : [];
  const idx = bundles.findIndex(b => b.id === bundle.id);
  let action;
  if (idx >= 0) {
    // Preservamos coverUrl si ya tenía uno cargado manualmente.
    const prev = bundles[idx];
    bundles[idx] = { ...bundle, coverUrl: prev.coverUrl || bundle.coverUrl };
    action = "updated";
  } else {
    bundles.unshift(bundle);
    action = "added";
  }
  current.bundles = bundles;

  const newContent = Buffer.from(JSON.stringify(current, null, 2) + "\n", "utf8")
    .toString("base64");

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `chore(bundles): ${action} ${bundle.id} via telegram webhook`,
      content: newContent,
      sha: fileMeta.sha,
      branch,
    }),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`GitHub PUT ${putRes.status}: ${t.slice(0, 200)}`);
  }
  return { action };
}
