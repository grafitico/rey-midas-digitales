// Resolver de carátulas:
//   GET /api/cover?q=<titulo>        → Nintendo Europe Solr (para bundles Switch)
//   GET /api/cover?psnId=<id>        → página de producto de PS Store (para destacados PS4/PS5)

const PSN_BASE = "https://store.playstation.com/es-cr";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Portada por PSN ID ─────────────────────────────────────────────────────
  const psnId = (req.query.psnId || "").toString().trim();
  if (psnId) {
    try {
      const url = `${PSN_BASE}/product/${encodeURIComponent(psnId)}`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
        },
      });
      if (!r.ok) return res.status(200).json({ coverUrl: "", psnId });
      const html = await r.text();
      const coverUrl = extractPsnCover(html);
      return res.status(200).json({ coverUrl, psnId });
    } catch (e) {
      return res.status(500).json({ error: e.message, coverUrl: "", psnId });
    }
  }

  // ── Portada Nintendo por título ────────────────────────────────────────────
  const raw = (req.query.q || "").toString().trim();
  if (!raw) return res.status(400).json({ error: "missing q or psnId" });

  const candidates = buildCandidates(raw);

  for (const q of candidates) {
    try {
      const url = `https://searching.nintendo-europe.com/en/select?q=${encodeURIComponent(q)}&fq=type%3AGAME&wt=json&rows=3`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
          "Accept": "application/json",
        },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const docs = data?.response?.docs || [];
      const hit = docs[0];
      if (!hit) continue;
      const img =
        hit.image_url_sq_s ||
        hit.image_url ||
        hit.image_url_h2x1_s ||
        hit.image_url_tm_s;
      if (!img) continue;
      const coverUrl = img.startsWith("//") ? `https:${img}` : img;
      return res.status(200).json({ coverUrl, matchedTitle: hit.title, queryUsed: q });
    } catch {
      // sigo con el siguiente candidato
    }
  }

  return res.status(200).json({ coverUrl: "" });
}

// ─── PSN helpers ─────────────────────────────────────────────────────────────

function extractPsnCover(html) {
  if (!html || html.length < 500) return "";
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return "";
  let data;
  try { data = JSON.parse(m[1]); } catch { return ""; }

  const cache = data?.props?.apolloState || {};
  for (const obj of Object.values(cache)) {
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename !== "Product" && !String(obj.id || "").match(/^[A-Z]{2}\d/)) continue;
    // media puede ser array de objetos directos o de __refs al apolloState
    const media = (Array.isArray(obj.media) ? obj.media : [])
      .map(m => (m?.__ref ? cache[m.__ref] : m))
      .filter(Boolean);
    const cover = pickPsnCover(media);
    if (cover) return cover;
  }
  return "";
}

function pickPsnCover(media) {
  if (!media?.length) return "";
  const byRole = (role) => media.find(m => m?.role === role && m.url)?.url;
  return (
    byRole("MASTER") ||
    byRole("GAMEHUB_COVER_ART") ||
    byRole("PORTRAIT") ||
    byRole("KEY_ART") ||
    media.find(m => m && (m.type === "IMAGE" || !m.type) && m.url)?.url ||
    ""
  );
}

// ─── Nintendo helpers ─────────────────────────────────────────────────────────

// Genera variantes del nombre para mejorar el chance de match:
// "Mortal Kombat™ 1" → ["Mortal Kombat™ 1", "Mortal Kombat 1", "Mortal Kombat"]
function buildCandidates(name) {
  const out = new Set();
  out.add(name);
  // Sin símbolos ™ ®
  const stripped = name.replace(/[™®©]/g, "").trim();
  out.add(stripped);
  // Sin "DLC", "Expansion Pass", "+ dlc"
  const noDlc = stripped
    .replace(/\s+\+\s+dlc/gi, "")
    .replace(/\bDLC\b/gi, "")
    .replace(/Expansion Pass/gi, "")
    .replace(/Upgrade Pack/gi, "")
    .trim();
  out.add(noDlc);
  // Sólo lo que está antes del primer ":" o " – "
  const beforeColon = noDlc.split(/[:–-]/)[0].trim();
  if (beforeColon.length > 3) out.add(beforeColon);
  return [...out].filter(Boolean);
}
