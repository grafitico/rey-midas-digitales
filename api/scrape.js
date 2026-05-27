export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { categoryId, page = "1", productId, mode } = req.query;

  try {
    if (mode === "category" && categoryId) {
      const url = `https://store.playstation.com/es-cr/category/${categoryId}/${page}`;
      const html = await fetchPSStore(url);
      const games = parseStorePage(html);
      return res.status(200).json({ success: true, count: games.length, games });
    }

    if (mode === "product" && productId) {
      const url = `https://store.playstation.com/es-cr/product/${productId}`;
      const html = await fetchPSStore(url);
      const game = parseProductPage(html, productId);
      return res.status(200).json({ success: true, game });
    }

    if (mode === "bulk") {
      const categories = JSON.parse(req.query.categories || "[]");
      let allGames = [];
      for (const cat of categories) {
        const pagesToFetch = Math.min(cat.pages || 1, 5);
        for (let p = 1; p <= pagesToFetch; p++) {
          const url = `https://store.playstation.com/es-cr/category/${cat.id}/${p}`;
          try {
            const html = await fetchPSStore(url);
            const parsed = parseStorePage(html);
            allGames = allGames.concat(parsed);
          } catch (e) { console.error(e.message); }
        }
      }
      const map = new Map();
      for (const g of allGames) map.set(g.id, g);
      return res.status(200).json({ success: true, count: map.size, games: Array.from(map.values()) });
    }

    return res.status(400).json({ success: false, error: "Especifica mode=category, product o bulk" });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function fetchPSStore(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
    },
  });
  if (!res.ok) throw new Error(`PS Store respondio ${res.status}`);
  return await res.text();
}

function parseStorePage(html) {
  const games = [];
  if (!html || html.length < 500) return games;

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const cache = data?.props?.apolloState || {};
      for (const key of Object.keys(cache)) {
        const obj = cache[key];
        if (!obj || typeof obj !== "object") continue;
        if (obj.__typename === "Product" || (obj.id && /^(EP|UP)/.test(obj.id))) {
          const product = normalizeProduct(obj);
          if (product) games.push(product);
        }
      }
    } catch (e) { console.error("parse error:", e.message); }
  }
  return games;
}

function normalizeProduct(p) {
  if (!p.id || !p.name) return null;
  const priceInfo = p.price || {};
  const current = parsePrice(priceInfo.discountedValue || priceInfo.basePrice);
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
    addedAt: Date.now(),
  };
}

function parsePrice(str) {
  if (!str) return 0;
  if (typeof str === "number") return str;
  const m = str.toString().match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

function parseProductPage(html, productId) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const cache = data?.props?.apolloState || {};
      for (const key of Object.keys(cache)) {
        if (cache[key]?.id === productId) return normalizeProduct(cache[key]);
      }
    } catch (e) {}
  }
  return null;
}
