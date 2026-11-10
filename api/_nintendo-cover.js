// Búsqueda de carátulas de Nintendo Switch en el buscador público de Nintendo
// Europa (Solr). La usan dos lugares:
//   - scripts/scrape-telegram.js: el robot guarda la carátula en
//     nintendo-bundles.json, así la página de Switch ya llega con las fotos.
//   - api/cover.js (?q=<título>): respaldo para los bundles que el robot no
//     resolvió todavía.

// Variantes del nombre a probar, de la más exacta a la más laxa.
export function buildCandidates(name) {
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

// Devuelve { coverUrl, matchedTitle, queryUsed } o { coverUrl: "" } si no hay
// coincidencia. `failed` = true cuando ninguna consulta pudo completarse (red
// caída, Nintendo respondiendo error): ese caso no debe guardarse como
// "no tiene carátula".
export async function findNintendoCover(raw, { timeoutMs = 8000 } = {}) {
  let answered = false;
  for (const q of buildCandidates(raw)) {
    try {
      const url = `https://searching.nintendo-europe.com/en/select?q=${encodeURIComponent(q)}&fq=type%3AGAME&wt=json&rows=3`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) continue;
      const data = await r.json();
      answered = true;
      const hit = data?.response?.docs?.[0];
      if (!hit) continue;
      const img = hit.image_url_sq_s || hit.image_url || hit.image_url_h2x1_s || hit.image_url_tm_s;
      if (!img) continue;
      const coverUrl = img.startsWith("//") ? `https:${img}` : img;
      return { coverUrl, matchedTitle: hit.title, queryUsed: q };
    } catch {
      // sigo con el siguiente candidato
    }
  }
  return { coverUrl: "", failed: !answered };
}
