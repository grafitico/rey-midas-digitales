// Vista previa para redes (WhatsApp, Facebook, Telegram, X…) en Banahosting.
//
// En Vercel lo hacía middleware.js (Edge Middleware). Apache no puede correr
// eso, así que deploy/.htaccess manda SOLO a esos robots a /api/og?path=<ruta>
// y esta función devuelve el index.html con <title>, og:image, og:description
// y JSON-LD del juego (reutiliza buildMeta/applyMeta de middleware.js). Los
// humanos nunca pasan por acá.
//
// Mejora sobre la versión de Vercel: además de destacados y Xbox, conoce todo el
// catálogo de PlayStation (ps-catalog.json + precios del día de ps-prices.json),
// que es de donde salen la mayoría de los juegos que se comparten.
//
// Lee los archivos del disco del hosting: la tienda vive en ~/reymidascr.com y
// esta app en ~/rey-midas-api (SITE_DIR los conecta). En local cae a la raíz
// del repo.

import fs from "fs";
import path from "path";
import { buildMeta, applyMeta } from "../middleware.js";

const SITE_DIR = (() => {
  const candidates = [process.env.SITE_DIR, path.join(process.cwd(), "..", "reymidascr.com"), process.cwd()].filter(Boolean);
  return candidates.find(d => fs.existsSync(path.join(d, "index.html"))) || process.cwd();
})();

// Cache: se recarga solo cuando cambia algún archivo (cada publicación).
const FILES = ["index.html", "featured-games.json", "covers.json", "xbox-catalog.json", "ps-catalog.json", "ps-prices.json", "reservaciones.json", "faq.json"];
let cache = { stamp: "", html: "", data: null };

function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SITE_DIR, name), "utf8")); } catch { return null; }
}

function load() {
  const stamp = FILES.map(f => { try { return fs.statSync(path.join(SITE_DIR, f)).mtimeMs; } catch { return 0; } }).join("|");
  if (cache.data && cache.stamp === stamp) return cache;

  const html = fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8");
  const covers = readJson("covers.json")?.covers || {};
  const prices = readJson("ps-prices.json")?.prices || {};
  const games = {};
  for (const g of readJson("ps-catalog.json")?.games || []) {
    if (!g?.id) continue;
    const p = prices[g.id];
    games[g.id] = p ? { ...g, priceUSD: p[0], originalPriceUSD: p[1] } : g;
  }
  for (const g of readJson("xbox-catalog.json")?.games || []) if (g?.id && !g._placeholder) games[g.id] = g;
  for (const g of readJson("featured-games.json")?.games || []) if (g?.id) games[g.id] = { ...g, imageUrl: g.imageUrl || covers[g.id] || "" };
  const reservaMap = {};
  for (const r of readJson("reservaciones.json")?.items || []) if (r?.id) reservaMap[r.id] = r;
  const faqs = readJson("faq.json")?.faqs || [];

  cache = { stamp, html, data: { games, reservaMap, faqs } };
  return cache;
}

// WhatsApp no muestra imágenes pesadas en la vista previa, y las portadas
// originales lo son (PNG de PSN de 1–3 MB, >2000 px; Microsoft igual). Cada
// tienda sirve la misma imagen achicada con un parámetro: se pide a 400 px.
const PREVIEW_PX = 400;
export function previewImage(src) {
  if (!src) return src;
  let u;
  try { u = new URL(src); } catch { return src; }
  if (u.host === "image.api.playstation.com") {
    u.searchParams.set("w", String(PREVIEW_PX));
    u.searchParams.set("thumb", "false");
    return u.toString();
  }
  if (/(^|\.)store-images\.(s-)?microsoft\.com$/.test(u.host)) {
    u.searchParams.set("w", String(PREVIEW_PX));
    u.searchParams.set("h", String(PREVIEW_PX));
    u.searchParams.set("q", "85");
    return u.toString();
  }
  if (u.host === "media.rawg.io" && /^\/media\/(games|screenshots)\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/^\/media\//, `/media/resize/${PREVIEW_PX * 2}/-/`);
    return u.toString();
  }
  return src;
}

export default async function handler(req, res) {
  const raw = String(req.query?.path || "/");
  const pathname = raw.startsWith("/") ? raw.slice(0, 300) : "/";
  try {
    const { html, data } = load();
    const meta = buildMeta(pathname, data);
    if (meta?.image) meta.image = previewImage(meta.image);
    const out = meta ? applyMeta(html, meta) : html;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Prerender", "1");
    return res.status(200).send(out);
  } catch (e) {
    console.error("[og]", e);
    // Ante cualquier problema, la página normal: nunca dejar al robot sin nada.
    try {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8"));
    } catch {
      return res.status(500).send("Error");
    }
  }
}
