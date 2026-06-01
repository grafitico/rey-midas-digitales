// Resolución de precios EN VIVO para el catálogo curado (featured-games.json).
//
// Estrategia:
//
// Fase 1 — páginas de deals/latest/catálogo en paralelo (~2s):
//   Resuelve los juegos que están en oferta y aparecen en esas páginas.
//   Rápido y con precio correcto (discountedPrice presente en apolloState).
//
// Fase 2 — búsqueda PSN para los no resueltos:
//   Cada resultado de búsqueda de PSN incluye el campo "discountedPrice" en
//   el objeto SkuPrice (confirmado via debug). Un solo request por juego es
//   suficiente — no se necesita ir a la página de producto.
//   Se procesan TODOS los títulos del catálogo curado (no solo 50).
//
// Para títulos no encontrados en ninguna fase, el cliente usa el priceUSD
// fijo de featured-games.json como fallback.

import { readFileSync } from "fs";
import { join } from "path";

const PSN_BASE = "https://store.playstation.com/es-cr";

const SOURCE_PAGES = [
  "/pages/deals",
  "/pages/latest",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/1",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/2",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/3",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/4",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/5",
  "/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/6",
];

// Procesar TODOS los títulos del catálogo curado via búsqueda (1 request cada
// uno). Con CONCURRENCY=20 y ~1.5s por búsqueda, 150 títulos pendientes tras
// Phase 1 = 150/20 × 1.5s = ~11s. Bien dentro del budget de 28s.
const SEARCH_CONCURRENCY = 20;
const TIME_BUDGET_MS = 27000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  const started = Date.now();
  try {
    const featured = loadFeatured();

    // ── FASE 1: páginas de catálogo/deals en paralelo ──────────────────────
    const fetched = await Promise.allSettled(
      SOURCE_PAGES.map(path => fetchAndParse(`${PSN_BASE}${path}`))
    );

    const liveMap = new Map();
    for (const r of fetched) {
      if (r.status !== "fulfilled") continue;
      for (const g of r.value) {
        const key = matchKey(g.name);
        const prev = liveMap.get(key);
        if (!prev || g.priceUSD < prev.priceUSD) liveMap.set(key, g);
      }
    }

    const prices = {};
    const phase1Resolved = new Set();
    for (const game of featured) {
      const live = liveMap.get(matchKey(game.title));
      if (!live) continue;
      prices[game.id] = toPriceEntry(live);
      phase1Resolved.add(game.id);
    }

    // ── FASE 2: búsqueda directa para TODOS los no resueltos ───────────────
    // El resultado de búsqueda PSN ya incluye discountedPrice correcto
    // (confirmado con debug). Un solo request por juego es suficiente.
    const toSearch = featured.filter(g => !phase1Resolved.has(g.id));

    let idx = 0;
    async function worker() {
      while (idx < toSearch.length) {
        if (Date.now() - started > TIME_BUDGET_MS) return;
        const game = toSearch[idx++];
        try {
          const live = await resolveViaSearch(game);
          if (live) prices[game.id] = live;
        } catch { /* skip */ }
      }
    }
    if (toSearch.length > 0) {
      await Promise.all(
        Array.from({ length: Math.min(SEARCH_CONCURRENCY, toSearch.length) }, worker)
      );
    }

    return res.status(200).json({
      success: true,
      stats: {
        sourcePages: SOURCE_PAGES.length,
        liveMapSize: liveMap.size,
        phase1: phase1Resolved.size,
        phase2Total: toSearch.length,
        resolved: Object.keys(prices).length,
        elapsedMs: Date.now() - started,
      },
      prices,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

// Búsqueda directa en PSN. La página de búsqueda incluye el objeto SkuPrice
// con discountedPrice correcto (igual que categoría/deals). Un solo request
// es suficiente — no hace falta ir a la página de producto.
async function resolveViaSearch(game) {
  const searchUrl = `${PSN_BASE}/search/${encodeURIComponent(game.title)}`;
  const results = await fetchAndParse(searchUrl);
  const target = matchKey(game.title);
  const exact = results.filter(p => matchKey(p.name) === target);
  if (!exact.length) return null;

  // Filtrar por plataforma si el destacado tiene una específica
  const wantsPS5 = /PS5/i.test(game.platform || "") && !/PS4/i.test(game.platform || "");
  const wantsPS4 = /PS4/i.test(game.platform || "") && !/PS5/i.test(game.platform || "");
  let candidates = exact;
  if (wantsPS5) {
    const f = exact.filter(p => (p.platforms || []).includes("PS5"));
    if (f.length) candidates = f;
  } else if (wantsPS4) {
    const f = exact.filter(p => (p.platforms || []).includes("PS4"));
    if (f.length) candidates = f;
  }

  // Elegir la opción más barata (edición base / mejor oferta)
  candidates.sort((a, b) => a.priceUSD - b.priceUSD);
  const chosen = candidates[0];
  if (!chosen || chosen.priceUSD <= 0) return null;
  return toPriceEntry(chosen);
}

function toPriceEntry(g) {
  return {
    priceUSD: g.priceUSD,
    originalPriceUSD: g.originalPriceUSD,
    onSale: g.onSale,
    discount: g.discount,
    url: g.url,
    psnId: g.id,
    platform: g.platform,
  };
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
  const deref = (val) =>
    val && typeof val === "object" && val.__ref ? (cache[val.__ref] ?? val) : val;

  const out = [];
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename === "Product" || (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id))) {
      const g = normalize({ ...obj, price: deref(obj.price) });
      if (g) out.push(g);
    }
  }
  return out;
}

function normalize(p) {
  if (!p.id || !p.name) return null;
  const priceInfo = p.price || {};
  // discountedPrice = campo real de PSN (SkuPrice). discountedValue = alias
  // de vistas más antiguas. Caemos a basePrice si no hay oferta.
  const current = parsePrice(priceInfo.discountedPrice ?? priceInfo.discountedValue ?? priceInfo.basePrice);
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
    platforms: plats,
    url: `https://store.playstation.com/es-cr/product/${p.id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
  };
}

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
