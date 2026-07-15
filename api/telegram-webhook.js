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

import { requireAdmin, handleError } from "./_lib.js";

const JSON_PATH = "nintendo-bundles.json";
const TG_API = "https://api.telegram.org";

export default async function handler(req, res) {
  // Rama de administración del webhook (antes vivía en /api/telegram-setup).
  // Se activa SOLO cuando la query trae ?setup; las llamadas reales de
  // Telegram nunca la incluyen, así que el flujo del webhook queda intacto.
  //   GET    /api/telegram-webhook?setup   → getWebhookInfo
  //   POST   /api/telegram-webhook?setup   → setWebhook
  //   DELETE /api/telegram-webhook?setup   → deleteWebhook
  if (req.query && typeof req.query.setup !== "undefined") {
    return telegramSetup(req, res);
  }

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

// ===== Administración del webhook (registrar / inspeccionar / borrar) =====
// Requiere autenticación de admin (mismo sistema que el resto del API).
// El URL del webhook se arma con PUBLIC_BASE_URL + /api/telegram-webhook.
async function telegramSetup(req, res) {
  try {
    await requireAdmin(req);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const baseUrl = process.env.PUBLIC_BASE_URL;

    if (!token) throw withStatus("Falta TELEGRAM_BOT_TOKEN", 500);

    if (req.method === "GET") {
      const info = await tgCall(token, "getWebhookInfo");
      return res.status(200).json({ ok: true, info });
    }

    if (req.method === "POST") {
      if (!secret) throw withStatus("Falta TELEGRAM_WEBHOOK_SECRET", 500);
      if (!baseUrl) throw withStatus("Falta PUBLIC_BASE_URL (ej https://reymidas.cr)", 500);

      const url = `${baseUrl.replace(/\/+$/, "")}/api/telegram-webhook`;
      const result = await tgCall(token, "setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["channel_post", "edited_channel_post"],
        drop_pending_updates: false,
      });
      return res.status(200).json({ ok: true, url, result });
    }

    if (req.method === "DELETE") {
      const result = await tgCall(token, "deleteWebhook", { drop_pending_updates: false });
      return res.status(200).json({ ok: true, result });
    }

    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    return handleError(res, e);
  }
}

async function tgCall(token, method, payload) {
  const r = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = await r.json();
  if (!json.ok) {
    throw withStatus(`Telegram ${method} falló: ${json.description}`, 502);
  }
  return json.result;
}

function withStatus(msg, status) {
  const err = new Error(msg);
  err.status = status;
  return err;
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
