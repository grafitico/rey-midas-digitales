// Busca la portada de un juego en Steam Store.
// Sin API key. Sin registro. Sin cupo mensual. 100% gratis.
//
// GET /api/steam-cover?q=<titulo>
// → { success, imageUrl, title, appId }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ success: false, error: "Falta q" });

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&cc=US&l=english`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)" },
    });
    if (!r.ok) return res.status(200).json({ success: false, error: `Steam HTTP ${r.status}` });

    const data = await r.json();
    const hit = data?.items?.[0];
    if (!hit?.id) return res.status(200).json({ success: true, imageUrl: "" });

    const appId = hit.id;
    // header.jpg = 460×215 (landscape, mismo formato que RAWG background_image)
    const imageUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

    return res.status(200).json({ success: true, imageUrl, title: hit.name, appId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
