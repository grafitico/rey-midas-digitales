// Resolver de carátulas de Nintendo Switch usando la búsqueda pública
// de Nintendo Europe (Solr, devuelve JSON sin auth).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
  if (req.method === "OPTIONS") return res.status(200).end();

  const raw = (req.query.q || "").toString().trim();
  if (!raw) return res.status(400).json({ error: "missing q" });

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
