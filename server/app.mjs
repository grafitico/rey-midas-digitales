// Servidor Node para las funciones /api/* fuera de Vercel (Banahosting, cPanel
// "Setup Node.js App"). Vercel ejecutaba cada archivo de api/ como una función
// con req.query, req.body y res.status().json(); este servidor hace lo mismo
// para que el código de api/ corra sin cambios.
//
// Apache sirve la tienda (archivos estáticos) y le pasa a este proceso solo
// las rutas /api/*. El arranque lo hace server/start.cjs (Passenger, el que usa
// cPanel, necesita un archivo CommonJS como "startup file").

import http from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = path.join(ROOT, "api");

// Mismas reescrituras que vercel.json.
const ALIASES = { "auth-google": "auth" };
// Solo se exponen estos (nada de _lib.js ni otros helpers).
const ROUTES = new Set([
  "analytics", "auth", "bundles", "chat", "clients", "cover", "featured-prices",
  "newsletter", "purchases", "rawg", "scrape", "telegram-webhook",
]);
const MAX_BODY = 1024 * 1024; // 1 MB

const handlers = new Map();
async function loadHandler(name) {
  if (!handlers.has(name)) {
    const mod = await import(pathToFileURL(path.join(API_DIR, `${name}.js`)).href);
    handlers.set(name, mod.default);
  }
  return handlers.get(name);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Body demasiado grande"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Igual que Vercel: JSON y formularios llegan ya parseados en req.body.
function parseBody(raw, contentType = "") {
  if (!raw) return undefined;
  if (contentType.includes("application/json")) { try { return JSON.parse(raw); } catch { return raw; } }
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return raw;
}

function addVercelHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
    return res;
  };
  res.send = (body) => {
    if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) return res.json(body);
    res.end(body);
    return res;
  };
  res.redirect = (a, b) => {
    const [code, url] = typeof a === "number" ? [a, b] : [307, a];
    res.statusCode = code;
    res.setHeader("Location", url);
    res.end();
    return res;
  };
}

export const server = http.createServer(async (req, res) => {
  addVercelHelpers(res);
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    // Passenger puede entregar la ruta con o sin el prefijo /api.
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    if (parts[0] === "api") parts.shift();
    const name = ALIASES[parts[0]] || parts[0];
    if (!ROUTES.has(name)) return res.status(404).json({ error: "No encontrado" });

    req.query = Object.fromEntries(url.searchParams);
    if (req.method !== "GET" && req.method !== "HEAD") {
      req.body = parseBody(await readBody(req), req.headers["content-type"] || "");
    }
    const handler = await loadHandler(name);
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (e) {
    console.error(`[server] ${req.method} ${req.url}:`, e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: "Error del servidor" });
    else if (!res.writableEnded) res.end();
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`[server] API escuchando en ${port}`));
