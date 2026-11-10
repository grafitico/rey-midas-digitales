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
      const url = `https://searching.nintendo-europe.com/en/select?q=${encodeURIComponent(q)}&fq=type%3AGAME&wt=json&rows=10`;
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
      const best = pickBest(data?.response?.docs || [], [raw, q]);
      if (!best) continue;
      return { coverUrl: best.coverUrl, matchedTitle: best.doc.title, queryUsed: q };
    } catch {
      // sigo con el siguiente candidato
    }
  }
  return { coverUrl: "", failed: !answered };
}

// Normaliza para comparar títulos: minúsculas, sin acentos ni símbolos.
export function normTitle(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function docImage(doc) {
  const img = doc.image_url_sq_s || doc.image_url || doc.image_url_h2x1_s || doc.image_url_tm_s;
  return img ? (img.startsWith("//") ? `https:${img}` : img) : "";
}

// ¿El resultado es de Switch / Switch 2? Nintendo lo marca en varios campos
// (system_names_txt, playable_on_txt: HAC/BEE, system_type) y en la ruta de la
// imagen (".../1x1_NSwitch_..."); una ficha de Wii U o 3DS no menciona Switch.
export function isSwitchDoc(doc) {
  const fields = [doc.system_names_txt, doc.system_type, doc.playable_on_txt, doc.pretty_game_categories_txt, docImage(doc)];
  const text = fields.flat().filter(Boolean).join(" ").toLowerCase();
  return /switch|\bhac\b|\bbee\b|nsw/.test(text);
}

// Elige el mejor resultado: Switch antes que otras consolas y, dentro de eso,
// el título idéntico al buscado. Así "Mario Kart 8 Deluxe" no se queda con la
// ficha de "Mario Kart 8" de Wii U, que Nintendo devuelve primero.
export function pickBest(docs, names) {
  const wanted = new Set(names.map(normTitle).filter(Boolean));
  let best = null, bestScore = -1;
  docs.forEach((doc, i) => {
    const coverUrl = docImage(doc);
    if (!coverUrl) return;
    const t = normTitle(doc.title);
    let score = 0;
    if (isSwitchDoc(doc)) score += 100;
    if (wanted.has(t)) score += 50;
    else if ([...wanted].some(w => t.startsWith(w) || w.startsWith(t))) score += 20;
    score -= i; // a igualdad, el orden de relevancia de Nintendo
    if (score > bestScore) { bestScore = score; best = { doc, coverUrl }; }
  });
  return best;
}
