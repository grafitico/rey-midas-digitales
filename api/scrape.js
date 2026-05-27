// PSPrices demo API proxy (no auth required, limit 24 games per call)
// Docs: https://psprices.com/b2b/playstation-api/

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const region = (req.query.region || "cr").toLowerCase();
  const collection = req.query.collection || "most-wanted-deals";

  try {
    const url = `https://psprices.com/api/b2b/demo/?region=${encodeURIComponent(region)}&collection=${encodeURIComponent(collection)}`;
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0; +https://rey-midas-digitales.vercel.app)",
        "Accept": "application/json",
      },
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(502).json({
        success: false,
        error: `PSPrices respondió ${upstream.status}`,
        upstreamBody: body.slice(0, 500),
      });
    }

    const data = await upstream.json();
    const rawList = Array.isArray(data)
      ? data
      : data.games || data.items || data.results || data.data || [];

    const games = rawList.map(normalize).filter(Boolean);

    return res.status(200).json({
      success: true,
      count: games.length,
      region,
      collection,
      games,
      attribution: "Powered by PSprices",
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

function normalize(g) {
  if (!g || typeof g !== "object") return null;
  const name = g.name || g.title || g.product_name;
  if (!name) return null;

  const pricing = g.pricing || g.price || {};
  const current = num(pricing.current_price ?? pricing.discounted_price ?? pricing.price ?? g.current_price);
  const original = num(pricing.original_price ?? pricing.base_price ?? g.original_price) || current;
  if (!current && current !== 0) return null;

  const platforms = (g.platforms || g.platform || []).map(p => String(p).toUpperCase());
  const hasPS5 = platforms.some(p => p.includes("PS5"));
  const hasPS4 = platforms.some(p => p.includes("PS4"));
  let platform = "PS4";
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";
  else if (!hasPS4 && /PS5/i.test(name)) platform = "PS5";

  const discount = Number.isFinite(pricing.discount_percent)
    ? Math.round(pricing.discount_percent)
    : original > current ? Math.round((1 - current / original) * 100) : 0;

  return {
    id: g.id || g.sku || g.title_id || name,
    title: name,
    platform,
    imageUrl: g.image_url || g.image || g.cover || g.cover_url || g.thumbnail || g.icon || "",
    url: g.url || g.store_url || g.psprices_url || "",
    priceUSD: current,
    originalPriceUSD: original,
    onSale: original > current,
    discount,
    currency: pricing.currency || g.currency || "USD",
    isBundle: /bundle|edition|collection|pack|deluxe|ultimate|gold|premium|definitive|remaster/i.test(name),
  };
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const m = String(v).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
