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
const FILES = ["index.html", "og-index.json", "reservaciones.json", "faq.json", "ps-bundles.json", "xbox-bundles.json"];
let cache = { stamp: "", html: "", data: null };

function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SITE_DIR, name), "utf8")); } catch { return null; }
}

// Índice de juegos para la vista previa, con solo los 5 campos que usa
// buildMeta. Lo arma scripts/build-dist.mjs al publicar (og-index.json, ~2 MB)
// para que la app no tenga que leer ps-catalog.json (11 MB): leer ese archivo
// en cada actualización de precios llevaba la app de 40 MB a 150–180 MB, y el
// hosting tiene un tope de memoria por cuenta que, al llenarse, deja a toda la
// API sin poder arrancar ("Unable to fork… resource limits").
export function buildGamesIndex(read) {
  const covers = read("covers.json")?.covers || {};
  const prices = read("ps-prices.json")?.prices || {};
  const slim = (g, priceUSD = g.priceUSD) => ({
    title: g.title, platform: g.platform, imageUrl: g.imageUrl || "",
    priceUSD, comingSoon: !!g.comingSoon,
  });
  const games = {};
  for (const g of read("ps-catalog.json")?.games || []) {
    if (!g?.id) continue;
    const p = prices[g.id];
    games[g.id] = slim(g, p ? p[0] : g.priceUSD);
  }
  for (const g of read("xbox-catalog.json")?.games || []) if (g?.id && !g._placeholder) games[g.id] = slim(g);
  for (const g of read("featured-games.json")?.games || []) if (g?.id) games[g.id] = slim({ ...g, imageUrl: g.imageUrl || covers[g.id] || "" });
  return games;
}

function load() {
  const stamp = FILES.map(f => { try { return fs.statSync(path.join(SITE_DIR, f)).mtimeMs; } catch { return 0; } }).join("|");
  if (cache.data && cache.stamp === stamp) return cache;
  cache = { stamp: "", html: "", data: null }; // soltar lo viejo antes de leer lo nuevo

  const html = fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8");
  // og-index.json lo genera la publicación; si falta (p. ej. en pruebas
  // locales), se arma desde los catálogos.
  const games = readJson("og-index.json")?.games || buildGamesIndex(readJson);
  const reservaMap = {};
  for (const r of readJson("reservaciones.json")?.items || []) if (r?.id) reservaMap[r.id] = r;
  const faqs = readJson("faq.json")?.faqs || [];
  const bundles = { ps: {}, xbox: {} };
  for (const b of readJson("ps-bundles.json")?.bundles || []) if (b?.id) bundles.ps[b.id] = b;
  for (const b of readJson("xbox-bundles.json")?.bundles || []) if (b?.id) bundles.xbox[b.id] = b;

  cache = { stamp, html, data: { games, reservaMap, faqs, bundles } };
  return cache;
}

// ===== Portada de un juego por su nombre (para "Mis compras") =====
// Las compras guardan el nombre del juego como lo escribió el admin
// ("God of War Ragnarök- PS4 y PS5", "FC 26 Standar"…). Se limpia igual que en
// el panel (sin acentos, ™, paréntesis ni palabras de edición) y se busca en el
// mismo índice de la vista previa, que ya está en memoria: no se lee ningún
// catálogo extra. El mapa título→portada se arma una vez por publicación.
const COVER_EDITION_WORDS = new Set(("standard standar estandar edition edicion deluxe ultimate digital gold " +
  "premium complete completa definitive definitiva juego del ano game of the year goty launch lanzamiento " +
  "version ps4 ps5 playstation playstation4 playstation5 y and de la el the for para cross gen bundle game").split(" "));
export function coverTitleKey(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/\bgta\b/g, "grand theft auto")
    .replace(/\bcod\b/g, "call of duty")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(w => w && !COVER_EDITION_WORDS.has(w)).join(" ");
}
let coverMap = { stamp: "", ps: null, xbox: null };
function coverMaps() {
  const { stamp, data } = load();
  if (coverMap.stamp === stamp && coverMap.ps) return coverMap;
  const ps = new Map(), xbox = new Map();
  for (const g of Object.values(data.games || {})) {
    if (!g?.imageUrl || !g.title) continue;
    const k = coverTitleKey(g.title);
    if (!k) continue;
    const m = /xbox/i.test(g.platform || "") ? xbox : ps;
    if (!m.has(k)) m.set(k, g.imageUrl);
  }
  coverMap = { stamp, ps, xbox };
  return coverMap;
}
// Portada achicada (px de ancho) para el título, o "" si no se encuentra.
export function findCover(title, platform = "", px = 160) {
  const key = coverTitleKey(title);
  if (!key) return "";
  const { ps, xbox } = coverMaps();
  const maps = /xbox/i.test(platform) ? [xbox, ps] : [ps, xbox];
  const words = key.split(" ");
  for (const m of maps) {
    if (m.has(key)) return sizedImage(m.get(key), px);
    // El nombre cargado suele traer de más ("… PS4 y PS5 Mexico"): probar el
    // título más largo que coincida palabra por palabra desde el principio.
    for (let n = words.length - 1; n >= 2; n--) {
      const k = words.slice(0, n).join(" ");
      if (k.length >= 8 && m.has(k)) return sizedImage(m.get(k), px);
    }
  }
  return "";
}

// WhatsApp no muestra imágenes pesadas en la vista previa, y las portadas
// originales lo son (PNG de PSN de 1–3 MB, >2000 px; Microsoft igual). Cada
// tienda sirve la misma imagen achicada con un parámetro: se pide a 400 px.
const PREVIEW_PX = 400;
export function previewImage(src) {
  return sizedImage(src, PREVIEW_PX);
}
// La misma imagen servida a `px` de ancho por la tienda que la aloja.
export function sizedImage(src, PREVIEW_PX) {
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
    if (meta?.image) {
      meta.image = previewImage(meta.image);
      // PlayStation y Microsoft sirven la portada cuadrada a 400 px (ver previewImage).
      meta.imageSize = /image\.api\.playstation\.com|store-images\.(s-)?microsoft\.com/.test(meta.image) ? [PREVIEW_PX, PREVIEW_PX] : null;
    }
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
