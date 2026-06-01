// Resolución de precios EN VIVO para el catálogo curado (featured-games.json).
//
// Estrategia en dos fases:
//
// Fase 1 — páginas rápidas (deals, latest, primeras de catálogo):
//   Se descargan en paralelo. Tienen discountedValue correcto. Si el título
//   aparece acá, se resuelve instantáneamente sin coste extra.
//
// Fase 2 — búsqueda + página de producto:
//   Para los títulos no resueltos en la fase 1, buscamos en PSN para obtener
//   el product ID real, y luego descargamos la página del producto individual
//   (que siempre tiene discountedValue correcto). Limitado a los primeros
//   SEARCH_LIMIT títulos del archivo (los más populares) para no superar el
//   tiempo máximo de la función.
//
// La búsqueda (/search/) sola no sirve porque PSN no incluye discountedValue
// en esas páginas — devuelve solo basePrice y nunca muestra ofertas.
// La página de producto (/product/{id}) sí tiene siempre el precio real.

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

// Máximo de títulos que van por búsqueda+producto (los N más importantes del
// featured-games.json). Cada uno cuesta ~2 requests; con CONCURRENCY=8 y
// ~1.5s/req da ≈ (SEARCH_LIMIT/8)×3s ≤ presupuesto restante de ~23s.
const SEARCH_LIMIT = 50;
const SEARCH_CONCURRENCY = 8;
const TIME_BUDGET_MS = 26000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── MODO DEBUG ──────────────────────────────────────────────────────────
  // /api/featured-prices?debug=<título> devuelve la estructura cruda del
  // precio tal cual la entrega PSN, para diagnosticar de qué campo sale el
  // precio descontado. Sin caché para ver siempre lo último.
  const debugTitle = (req.query?.debug || "").toString().trim();
  if (debugTitle) {
    res.setHeader("Cache-Control", "no-store");
    try {
      const out = await debugProduct(debugTitle);
      return res.status(200).json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
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

    // ── FASE 2: búsqueda + página de producto para no resueltos ────────────
    // Tomamos los primeros SEARCH_LIMIT no resueltos (orden = popularidad en
    // featured-games.json, los más buscados van primero).
    const toSearch = featured
      .filter(g => !phase1Resolved.has(g.id))
      .slice(0, SEARCH_LIMIT);

    let idx = 0;
    async function worker() {
      while (idx < toSearch.length) {
        if (Date.now() - started > TIME_BUDGET_MS) return;
        const game = toSearch[idx++];
        try {
          const live = await resolveViaProductPage(game, started);
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
        phase2Candidates: toSearch.length,
        resolved: Object.keys(prices).length,
        elapsedMs: Date.now() - started,
      },
      prices,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

// Busca el título en PSN para obtener el product ID real, luego descarga la
// página del producto individual donde discountedValue siempre está presente.
async function resolveViaProductPage(game, started) {
  if (Date.now() - started > TIME_BUDGET_MS) return null;

  // Paso A: búsqueda para obtener product ID
  const searchUrl = `${PSN_BASE}/search/${encodeURIComponent(game.title)}`;
  const searchResults = await fetchAndParse(searchUrl);
  const target = matchKey(game.title);
  const exact = searchResults.filter(p => matchKey(p.name) === target);
  if (!exact.length) return null;

  // Elegir candidato por plataforma y menor precio
  const wantsPS5 = /PS5/i.test(game.platform || "");
  const wantsPS4 = /PS4/i.test(game.platform || "");
  let candidates = exact;
  if (wantsPS5 && !wantsPS4) {
    const f = exact.filter(p => (p.platforms || []).includes("PS5"));
    if (f.length) candidates = f;
  } else if (wantsPS4 && !wantsPS5) {
    const f = exact.filter(p => (p.platforms || []).includes("PS4"));
    if (f.length) candidates = f;
  }
  candidates.sort((a, b) => a.priceUSD - b.priceUSD);
  const chosen = candidates[0];

  if (Date.now() - started > TIME_BUDGET_MS) return null;

  // Paso B: página del producto para leer discountedValue real
  const productUrl = `${PSN_BASE}/product/${chosen.id}`;
  const productResults = await fetchAndParse(productUrl);
  // La página del producto incluye el producto principal y quizás algunos
  // relacionados; buscamos el que tenga el mismo ID.
  const product = productResults.find(p => p.id === chosen.id) || productResults[0];

  if (product && product.priceUSD > 0) return toPriceEntry(product);

  // Fallback: devolver lo de la búsqueda (puede ser precio base, mejor que nada)
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

// Diagnóstico: busca un título, agarra el primer match exacto, descarga su
// página de producto y devuelve TODOS los objetos del apolloState cuyo
// __typename sea "Price" (o cuya clave empiece con "Price"), más el objeto
// Product crudo. Así vemos exactamente de qué campo sale el descuento.
async function debugProduct(title) {
  const searchUrl = `${PSN_BASE}/search/${encodeURIComponent(title)}`;
  const searchHtml = await fetchHtml(searchUrl);
  const searchCache = extractCache(searchHtml);
  const target = matchKey(title);

  // Encontrar el Product que matchea exacto en la búsqueda
  let productKey = null;
  for (const [k, obj] of Object.entries(searchCache)) {
    if (obj && typeof obj === "object" && obj.name && matchKey(obj.name) === target) {
      productKey = k;
      break;
    }
  }
  const searchProduct = productKey ? searchCache[productKey] : null;
  const productId = searchProduct?.id;

  let productCache = {};
  if (productId) {
    const productHtml = await fetchHtml(`${PSN_BASE}/product/${productId}`);
    productCache = extractCache(productHtml);
  }

  // Recolectar entradas de precio de ambos caches
  const collectPrices = (cache) => {
    const out = {};
    for (const [k, v] of Object.entries(cache)) {
      if (k.startsWith("Price") || (v && v.__typename === "Price") ||
          (v && (v.basePrice != null || v.discountedValue != null || v.discountedPrice != null))) {
        out[k] = v;
      }
    }
    return out;
  };

  // El objeto Product de la página de producto
  let productPageProduct = null;
  for (const [k, obj] of Object.entries(productCache)) {
    if (obj && obj.id && obj.id === productId) { productPageProduct = obj; break; }
  }

  return {
    title,
    productId,
    searchProduct_priceField: searchProduct?.price ?? null,
    productPageProduct_priceField: productPageProduct?.price ?? null,
    searchPriceEntries: collectPrices(searchCache),
    productPriceEntries: collectPrices(productCache),
  };
}

function extractCache(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return {};
  try { return JSON.parse(m[1])?.props?.apolloState || {}; } catch { return {}; }
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.text();
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
  // Apollo normaliza su caché usando refs ({ __ref: "Type:id" }) en vez de
  // datos inline. Esto ocurre en páginas de producto individual y en algunas
  // de búsqueda: p.price es { __ref: "Price:UP9000-..." } y sin resolver el
  // ref el precio aparece vacío → se toma el basePrice = precio completo sin
  // descuento. La función deref resuelve el puntero al objeto real del caché.
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
  // PSN expone el precio de oferta como "discountedPrice" (objetos SkuPrice de
  // las páginas de búsqueda/catálogo). Versiones más viejas/otras vistas usan
  // "discountedValue". Probamos ambos y caemos a basePrice si no hay oferta.
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
