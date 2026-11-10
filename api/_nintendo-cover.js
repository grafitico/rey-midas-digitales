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
  return String(s || "").replace(/[™®©]/g, "").replace(/['’`]/g, "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2") // "wrc8" → "wrc 8"
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function docImage(doc) {
  const img = doc.image_url_sq_s || doc.image_url || doc.image_url_h2x1_s || doc.image_url_tm_s;
  return img ? (img.startsWith("//") ? `https:${img}` : img) : "";
}

// ¿El resultado es de Switch / Switch 2? Nintendo lo marca en varios campos
// (system_names_txt: "Nintendo Switch", playable_on_txt: HAC/BEE). Ojo: la ruta
// de la imagen no sirve, Nintendo usa archivos "SQ_WiiU_..." en fichas de Switch.
export function isSwitchDoc(doc) {
  const fields = [doc.system_names_txt, doc.system_type, doc.playable_on_txt];
  const text = fields.flat().filter(Boolean).join(" ").toLowerCase();
  return /switch|\bhac\b|\bbee\b/.test(text);
}

// Números del título ("FIFA 18" → ["18"]; "WRC8" → ["8"]).
const numbers = t => (normTitle(t).match(/\d+/g) || []);
// Palabras que no distinguen un juego de otro.
const STOP = new Set(["the", "of", "for", "and", "a", "an", "s", "de", "la", "le", "el", "les", "du", "des",
  "edition", "nintendo", "switch", "version", "ver", "dlc", "pack", "game", "games"]);
// Palabras con significado, sin repetir: fuera números, letras sueltas ("2K" →
// "2 k") y palabras genéricas.
const words = t => [...new Set(normTitle(t).split(" ").filter(w => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w)))];

// Título principal, sin el subtítulo ("Snipperclips – Cut it out, together!" → "snipperclips").
const SUBTITLE = /\s[:–—-]\s|:\s/;
const mainTitle = t => normTitle(String(t || "").split(SUBTITLE)[0]);
const hasSubtitle = t => SUBTITLE.test(String(t || ""));

// Elige el mejor resultado: Switch antes que otras consolas y, dentro de eso,
// el título idéntico al buscado. Así "Mario Kart 8 Deluxe" no se queda con la
// ficha de "Mario Kart 8" de Wii U, que Nintendo devuelve primero.
// Si el título no es idéntico, descarta lo que sería otro juego (mejor sin
// portada que con la de otro): fichas que no son de Switch, resultados con un
// número que el título no tiene ("FIFA 12" para "FIFA 18", "Trivial Pursuit
// Live 2" para "Live!") y resultados de nombre distinto ("Bark" para "ARK",
// "NBA Bounce" para "NBA 2K22"). Se acepta si coincide el título principal
// (sin subtítulo), si la mayoría de las palabras del resultado están en el título
// (70 %; traducciones y ediciones: "Mario + Rabbids Kingdom Battle" para
// "Mario + The Lapins Crétins Kingdom Battle") o si el resultado contiene casi todas
// las palabras del título ("WRC 8 FIA World Rally Championship" para "WRC8").
export function pickBest(docs, names) {
  const wanted = new Set(names.map(normTitle).filter(Boolean));
  const wantedNums = new Set(names.flatMap(numbers));
  const wantedWords = new Set(names.flatMap(words));
  const queryWords = words(names[0]);
  // Números que identifican la entrega ("NINJA GAIDEN 3: Razor's Edge" → ["3"]);
  // no cuentan los de capítulo, pase, nivel, etc. ("DELTARUNE Chapter 1").
  const mainNums = numbers(mainTitle(names[0])
    .replace(/\b(chapter|part|episode|ep|vol|volume|season|tier|pack|level|kit|dlc)\s*\d+/g, ""));
  let best = null, bestScore = -Infinity;
  docs.forEach((doc, i) => {
    const coverUrl = docImage(doc);
    if (!coverUrl) return;
    const exact = wanted.has(normTitle(doc.title));
    const sw = isSwitchDoc(doc);
    let overlap = 1;
    if (!exact) {
      if (!sw) return;
      const docNums = numbers(doc.title);
      if (!docNums.every(n => wantedNums.has(n))) return;     // "FIFA 12" para "FIFA 18"
      if (!mainNums.every(n => docNums.includes(n))) return;  // "Ragebound" para "Ninja Gaiden 3"
      const w = words(doc.title);
      if (!w.length) return;
      const docFirst = normTitle(doc.title).split(" ")[0];
      if (w.length === 1 && docFirst !== queryWords[0]) return; // "Baseball" para "Disaster Report 4 - Baseball…", "B.ARK" para "ARK"
      overlap = w.filter(x => wantedWords.has(x)).length / w.length;
      const docSet = new Set(w);
      const covers = queryWords.length >= 2 ? queryWords.filter(x => docSet.has(x)).length / queryWords.length : 0;
      // Mismo título principal, salvo que los dos traigan subtítulos distintos
      // ("TRANSFORMERS: Galactic Trials" no es "TRANSFORMERS: BATTLEGROUNDS").
      const sameMain = wanted.has(mainTitle(doc.title)) && !(hasSubtitle(doc.title) && hasSubtitle(names[0]));
      // Título de una sola palabra clave ("WRC8", "DELTARUNE Chapter 1",
      // "Borderlands 3 DLC"): vale el resultado que empieza con ella.
      const sameStart = queryWords.length === 1 && docFirst === queryWords[0];
      if (!sameMain && !sameStart && overlap < 0.7 && covers < 0.8) return;
    }
    let score = (sw ? 100 : 0) + (exact ? 50 : 0) + overlap * 20 - i;
    if (score > bestScore) { bestScore = score; best = { doc, coverUrl }; }
  });
  return best;
}
