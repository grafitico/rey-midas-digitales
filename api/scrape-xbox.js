// Scraper de Xbox Store. Intenta parsear las páginas públicas de promociones
// de xbox.com extrayendo el JSON embebido. Prueba varios locales en orden.

const PAGES = [
  "https://www.xbox.com/es-cr/promotions/sales/sales-and-specials",
  "https://www.xbox.com/es-mx/promotions/sales/sales-and-specials",
  "https://www.xbox.com/en-us/promotions/sales/sales-and-specials",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  if (req.method === "OPTIONS") return res.status(200).end();

  const urls = req.query.urls
    ? String(req.query.urls).split(",").map(s => s.trim()).filter(Boolean)
    : PAGES;

  const errors = [];
  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      const games = parseGames(html);
      if (games.length) {
        return res.status(200).json({
          success: true,
          count: games.length,
          source: url,
          games,
        });
      }
      errors.push({ url, reason: "no-games-found" });
    } catch (e) {
      errors.push({ url, reason: e.message });
    }
  }
  return res.status(200).json({
    success: true,
    count: 0,
    games: [],
    errors,
    note: "No se pudo extraer juegos de Xbox. La página puede estar bloqueando bots o el formato cambió.",
  });
}

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function parseGames(html) {
  if (!html || html.length < 500) return [];

  // Estrategia 1: __NEXT_DATA__ (algunas páginas de xbox.com lo usan)
  const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (next) {
    try { return extractFromNext(JSON.parse(next[1])); } catch {}
  }

  // Estrategia 2: window.__PRELOADED_STATE__ inyectado
  const pre = html.match(/window\.__PRELOADED_STATE__\s*=\s*({[\s\S]+?});\s*<\/script>/);
  if (pre) {
    try { return extractFromState(JSON.parse(pre[1])); } catch {}
  }

  // Estrategia 3: bloques JSON-LD con ofertas
  const lds = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]+?)<\/script>/g)];
  if (lds.length) {
    const out = [];
    for (const m of lds) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const it of items) {
          const g = normalizeJSONLD(it);
          if (g) out.push(g);
        }
      } catch {}
    }
    if (out.length) return dedupe(out);
  }

  // Estrategia 4: cualquier objeto con bigCatalogId/productId disperso en scripts
  const ids = [...new Set([...html.matchAll(/"productId"\s*:\s*"([A-Z0-9]{12})"/g)].map(m => m[1]))];
  if (ids.length) {
    // No podemos resolver datos completos sin otra llamada; devolvemos shells
    return ids.slice(0, 24).map(id => ({
      id: `xbox-${id}`,
      title: `Juego Xbox (${id})`,
      platform: "Xbox",
      imageUrl: "",
      url: `https://www.xbox.com/games/store/_/${id}`,
      priceUSD: 0,
      originalPriceUSD: 0,
      onSale: false,
      discount: 0,
      _placeholder: true,
    }));
  }

  return [];
}

// Extracción para __NEXT_DATA__
function extractFromNext(data) {
  const queries = data?.props?.pageProps;
  if (!queries) return [];
  const candidates = collectProductObjects(queries);
  return dedupe(candidates.map(normalizeXboxProduct).filter(Boolean));
}

function extractFromState(state) {
  const out = collectProductObjects(state);
  return dedupe(out.map(normalizeXboxProduct).filter(Boolean));
}

// Recorre recursivamente buscando objetos que parezcan productos
function collectProductObjects(obj, depth = 0, found = []) {
  if (!obj || depth > 6) return found;
  if (Array.isArray(obj)) {
    obj.forEach(item => collectProductObjects(item, depth + 1, found));
    return found;
  }
  if (typeof obj !== "object") return found;
  if (obj.productId && (obj.title || obj.productTitle) && obj.price !== undefined) {
    found.push(obj);
  } else if (obj.bigCatalogId && obj.displayName) {
    found.push(obj);
  }
  for (const k of Object.keys(obj)) {
    collectProductObjects(obj[k], depth + 1, found);
  }
  return found;
}

function normalizeXboxProduct(p) {
  const id = p.productId || p.bigCatalogId || p.id;
  if (!id) return null;
  const title = p.productTitle || p.title || p.displayName || p.name;
  if (!title) return null;
  const priceObj = p.price || p.localizedPrice || p.purchase || {};
  const current = num(priceObj.listPrice ?? priceObj.msrp ?? priceObj.price ?? p.currentPrice);
  const original = num(priceObj.msrp ?? priceObj.listPrice ?? p.originalPrice) || current;
  if (!current) return null;
  const onSale = original > current;
  const imageUrl =
    p.imageUrl ||
    p.image?.url ||
    p.imageType?.posterArt?.url ||
    p.poster?.url ||
    p.boxArt?.url ||
    p.tileImage ||
    "";
  return {
    id: `xbox-${id}`,
    title,
    platform: "Xbox",
    imageUrl: cleanImage(imageUrl),
    url: `https://www.xbox.com/games/store/_/${id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
  };
}

function normalizeJSONLD(item) {
  if (item["@type"] !== "Product" && item["@type"] !== "VideoGame") return null;
  const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
  const current = num(offers?.price);
  if (!current) return null;
  const original = num(offers?.priceSpecification?.price) || current;
  const id = item.sku || item.productID || item.name;
  const onSale = original > current;
  return {
    id: `xbox-${id}`,
    title: item.name,
    platform: "Xbox",
    imageUrl: typeof item.image === "string" ? item.image : item.image?.[0] || "",
    url: item.url || "",
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
  };
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const m = String(v).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

function cleanImage(url) {
  if (!url) return "";
  return url.startsWith("//") ? `https:${url}` : url;
}

function dedupe(list) {
  const map = new Map();
  for (const g of list) if (!map.has(g.id)) map.set(g.id, g);
  return Array.from(map.values()).sort((a, b) => {
    if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
    return b.discount - a.discount;
  });
}
