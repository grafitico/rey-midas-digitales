// Resolución de precios EN VIVO para el catálogo curado (featured-games.json).
//
// Problema raíz: las páginas de búsqueda de PSN (/search/{q}) no incluyen
// el campo "discountedValue" en su apolloState — solo "basePrice". Por eso
// la primera versión de este endpoint devolvía el precio COMPLETO ($69.99)
// en vez del precio en oferta ($29.39).
//
// Solución: en vez de buscar por título, descargamos las mismas páginas que
// usa api/scrape.js (deals, latest, primeras páginas de categoría). Esas sí
// tienen el precio con descuento correcto. Mapeamos por matchKey y devolvemos
// las coincidencias. Para featured titles sin oferta activa, el cliente
// conserva el priceUSD fijo de featured-games.json como fallback.

import { readFileSync } from "fs";
import { join } from "path";

const PSN_BASE = "https://store.playstation.com/es-cr";

// Páginas a scrapear. deals y latest ya tienen precios con descuento.
// Agregamos las primeras páginas del catálogo principal para mayor cobertura.
const SOURCE_PAGES = [
  "/pages/deals",
  "/pages/latest",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/1",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/2",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/3",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/4",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const featured = loadFeatured();

    // Descargar todas las páginas fuente en paralelo
    const fetched = await Promise.allSettled(
      SOURCE_PAGES.map(path => fetchAndParse(`${PSN_BASE}${path}`))
    );

    // Construir mapa: matchKey(título) → mejor precio (el más bajo si aparece
    // en más de una página)
    const liveMap = new Map();
    for (const r of fetched) {
      if (r.status !== "fulfilled") continue;
      for (const g of r.value) {
        const key = matchKey(g.name);
        const prev = liveMap.get(key);
        if (!prev || g.priceUSD < prev.priceUSD) liveMap.set(key, g);
      }
    }

    // Resolver cada featured title contra el mapa
    const prices = {};
    let resolved = 0;
    for (const game of featured) {
      const live = liveMap.get(matchKey(game.title));
      if (!live) continue;
      prices[game.id] = {
        priceUSD: live.priceUSD,
        originalPriceUSD: live.originalPriceUSD,
        onSale: live.onSale,
        discount: live.discount,
        url: live.url,
        psnId: live.id,
        platform: live.platform,
      };
      resolved++;
    }

    return res.status(200).json({
      success: true,
      stats: { sourcePages: SOURCE_PAGES.length, liveProducts: liveMap.size, resolved },
      prices,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

function loadFeatured() {
  const raw = readFileSync(join(process.cwd(), "featured-games.json"), "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data.games) ? data.games.filter(g => g && g.title) : [];
}

async function fetchAndParse(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  const html = await r.text();
  return parseGames(html);
}

function parseGames(html) {
  if (!html || html.length < 500) return [];
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }

  const cache = data?.props?.apolloState || {};
  const out = [];
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename === "Product" || (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id))) {
      const g = normalize(obj);
      if (g) out.push(g);
    }
  }
  return out;
}

function normalize(p) {
  if (!p.id || !p.name) return null;
  const priceInfo = p.price || {};
  const current = parsePrice(priceInfo.discountedValue ?? priceInfo.basePrice);
  const original = parsePrice(priceInfo.basePrice) || current;
  if (!current) return null;

  const plats = p.platforms || [];
  const hasPS5 = plats.includes("PS5") || /PS5/i.test(p.name);
  const hasPS4 = plats.includes("PS4");
  let platform = "PS4";
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";

  const onSale = original > current;
  return {
    id: p.id,
    name: p.name,
    platform,
    url: `https://store.playstation.com/es-cr/product/${p.id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
  };
}

// Normalización idéntica a matchKey() en el cliente (app.js)
function matchKey(t) {
  return String(t || "")
    .replace(/[™®©]/g, "")
    .replace(/\s*\[(PS5|PS4|XBOX|Xbox|Series X\|S|Series X)\]/gi, "")
    .replace(/\b(Standard|Deluxe|Ultimate|Gold|Premium|Definitive|Complete|GOTY|Game of the Year|Collector'?s)\s+Edition\b/gi, "")
    .replace(/\b(Cross[- ]?Gen Bundle|Bundle|Pack)\b/gi, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parsePrice(str) {
  if (str == null) return 0;
  if (typeof str === "number") return str;
  const m = String(str).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
