// Scraper directo de PlayStation Store (sin terceros).
// Fetcha varias páginas del store en paralelo, extrae los juegos
// del JSON embebido en __NEXT_DATA__, los normaliza y deduplica.

const DEFAULT_URLS = [
  "https://store.playstation.com/es-cr/pages/deals",
  "https://store.playstation.com/es-cr/pages/latest",
  "https://store.playstation.com/es-cr/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/1",
  "https://store.playstation.com/es-cr/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/2",
  "https://store.playstation.com/es-cr/category/44d8bb20-653e-431e-8ad0-c0a365f68d2f/3",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  if (req.method === "OPTIONS") return res.status(200).end();

  const urls = req.query.urls
    ? String(req.query.urls).split(",").map(s => s.trim()).filter(Boolean)
    : DEFAULT_URLS;

  try {
    const results = await Promise.allSettled(urls.map(fetchAndParse));
    const errors = [];
    const map = new Map();
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        for (const g of r.value) {
          if (!map.has(g.id)) map.set(g.id, g);
        }
      } else {
        errors.push({ url: urls[i], error: r.reason?.message || String(r.reason) });
      }
    });

    const games = Array.from(map.values()).sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return b.discount - a.discount;
    });

    return res.status(200).json({
      success: true,
      count: games.length,
      sourcesOk: results.filter(r => r.status === "fulfilled").length,
      sourcesTotal: urls.length,
      errors: errors.length ? errors : undefined,
      games,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
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

  let platform = "PS4";
  const plats = p.platforms || [];
  const hasPS5 = plats.includes("PS5") || /PS5/i.test(p.name);
  const hasPS4 = plats.includes("PS4");
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";

  let imageUrl = "";
  if (Array.isArray(p.media)) {
    const img = p.media.find(m => m.role === "MASTER") || p.media[0];
    if (img) imageUrl = img.url;
  }

  const onSale = original > current;
  return {
    id: p.id,
    title: p.name,
    platform,
    imageUrl,
    url: `https://store.playstation.com/es-cr/product/${p.id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
    isBundle: /bundle|edition|collection|pack|trilogy|complete|deluxe|ultimate|gold|premium|definitive|remaster/i.test(p.name),
  };
}

function parsePrice(str) {
  if (str == null) return 0;
  if (typeof str === "number") return str;
  const m = String(str).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
