// Resolver de carátulas y fichas de juego (todo en español):
//   GET /api/cover?q=<titulo>            → Nintendo Europe Solr (carátula bundles Switch)
//   GET /api/cover?psnId=<id>            → carátula desde PS Store (destacados PS4/PS5)
//   GET /api/cover?psnId=<id>&full=1     → ficha completa de PS Store (español): descripción,
//                                          distribuidora, géneros, fecha, capturas y video
//   GET /api/cover?vandal=<titulo>       → ficha de respaldo desde vandal.elespanol.com (español)

const PSN_BASE = "https://store.playstation.com/es-cr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Diagnóstico: estructura real del apolloState de PSN para un título ───────
  //    /api/cover?psnDebug=<titulo>  (busca el juego, abre su producto y resume)
  const psnDebug = (req.query.psnDebug || "").toString().trim();
  if (psnDebug) {
    try {
      const id = await psnSearchFirstId(psnDebug);
      if (!id) return res.status(200).json({ error: "sin match en PSN", title: psnDebug });
      const r = await fetch(`${PSN_BASE}/product/${encodeURIComponent(id)}`, {
        headers: { "User-Agent": UA, "Accept-Language": "es-CR,es;q=0.9,en;q=0.8" },
      });
      const html = r.ok ? await r.text() : "";
      return res.status(200).json({ title: psnDebug, httpOk: r.ok, ...debugPsn(html, id) });
    } catch (e) {
      return res.status(200).json({ error: e.message, title: psnDebug });
    }
  }

  // ── PS Store por PSN ID: carátula o ficha completa ──────────────────────────
  const psnId = (req.query.psnId || "").toString().trim();
  if (psnId) {
    const full = req.query.full === "1" || req.query.full === "true";
    try {
      const url = `${PSN_BASE}/product/${encodeURIComponent(psnId)}`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
        },
      });
      if (!r.ok) return res.status(200).json(full ? emptyFicha(psnId) : { coverUrl: "", psnId });
      const html = await r.text();
      if (req.query.debug === "1") return res.status(200).json(debugPsn(html, psnId));
      if (full) return res.status(200).json({ ...extractPsnFicha(html, psnId), source: "psn", psnId });
      return res.status(200).json({ coverUrl: extractPsnCover(html), psnId });
    } catch (e) {
      return res.status(500).json(full ? emptyFicha(psnId) : { error: e.message, coverUrl: "", psnId });
    }
  }

  // ── Vandal (respaldo de ficha en español por título) ────────────────────────
  const vandalTitle = (req.query.vandal || "").toString().trim();
  if (vandalTitle) {
    try {
      const ficha = await fetchVandalFicha(vandalTitle);
      return res.status(200).json({ ...ficha, source: "vandal" });
    } catch (e) {
      return res.status(200).json({ ...emptyFicha(""), source: "vandal", error: e.message });
    }
  }

  // ── Portada Nintendo por título ────────────────────────────────────────────
  const raw = (req.query.q || "").toString().trim();
  if (!raw) return res.status(400).json({ error: "missing q, psnId or vandal" });

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
  const cache = parseApolloState(html);
  if (!cache) return "";
  return pickPsnCover(collectAllMedia(cache));
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

function emptyFicha(psnId) {
  return { coverUrl: "", description: "", publisher: "", developer: "", genres: [], released: "", screenshots: [], videoUrl: "", psnId };
}

// Ficha completa desde la página de producto de PS Store (es-cr → todo en español).
// PSN separa Product (precio/SKU) de Concept (juego: descripción larga, capturas,
// video). Escaneamos TODO el apolloState para no depender de en cuál objeto vive
// cada dato.
function extractPsnFicha(html, psnId) {
  const out = emptyFicha(psnId);
  if (!html || html.length < 500) return out;

  // Descripción en español desde el HTML server-rendered. La galería (capturas,
  // video) la carga PSN por JS y NO está en el HTML; la descripción sí suele
  // venir en el JSON-LD (SEO) o en las meta og/twitter.
  out.description = extractMetaDescription(html);

  const cache = parseApolloState(html);
  if (!cache) return out;

  // Reunir TODA la media del apolloState (de cualquier Product/Concept).
  const media = collectAllMedia(cache);
  out.coverUrl = pickPsnCover(media);

  // Capturas: rol SCREENSHOT; si ese rol no existe, imágenes que no sean
  // carátula/fondo/logo (excluimos también la portada ya elegida).
  const nonShotRoles = new Set([
    "MASTER", "GAMEHUB_COVER_ART", "PORTRAIT", "KEY_ART", "BACKGROUND",
    "BACKGROUND_LAYER_ART", "BACKGROUND_GLOBAL_NAV", "LOGO", "BUNDLE_ART",
    "STORE_DISPLAY_CLASSIFICATION", "GAME_HUB_COVER_ART",
  ]);
  let shots = media.filter(m => m.role === "SCREENSHOT" && isImage(m)).map(m => m.url);
  if (!shots.length) {
    shots = media.filter(m => isImage(m) && m.url !== out.coverUrl && !nonShotRoles.has(m.role)).map(m => m.url);
  }
  out.screenshots = [...new Set(shots)].slice(0, 6);

  // Video de preview/gameplay (preferimos un mp4 reproducible con <video>).
  out.videoUrl = pickPsnVideo(media);

  // Metadatos: buscados en cualquier objeto del cache (Product o Concept).
  out.publisher = firstField(cache, ["publisherName", "providerName", "publisher"]) || "";
  out.developer = firstField(cache, ["developerName", "developer"]) || "";
  out.genres = normalizeGenres(firstField(cache, ["localizedGenres", "genres", "genreNames"]));
  const rel = firstField(cache, ["releaseDate", "releaseDateText"]);
  out.released = rel ? String(rel).slice(0, 10) : "";

  // Descripción larga: el string de prosa más largo del cache (vive en el Concept).
  const long = longestDescription(cache);
  if (long && long.length > out.description.length) out.description = long;

  return out;
}

function parseApolloState(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1])?.props?.apolloState || null; } catch { return null; }
}

function isImage(m) {
  return !!(m && m.url && (m.type === "IMAGE" || !m.type) && !/\.(mp4|webm|m3u8)(\?|$)/i.test(m.url));
}

// Reúne todos los items de media de todos los objetos del apolloState
// (resolviendo __refs y deduplicando por URL).
function collectAllMedia(cache) {
  const all = [];
  const seen = new Set();
  for (const obj of Object.values(cache)) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.media)) continue;
    for (const item of obj.media) {
      const m = item?.__ref ? cache[item.__ref] : item;
      if (m && m.url && !seen.has(m.url)) { seen.add(m.url); all.push(m); }
    }
  }
  return all;
}

function pickPsnVideo(media) {
  const vids = media.filter(m => m.url && (m.type === "VIDEO" || m.role === "PREVIEW" || /\.(mp4|webm)(\?|$)/i.test(m.url)));
  if (!vids.length) return "";
  return (vids.find(v => /\.mp4(\?|$)/i.test(v.url)) || vids[0]).url;
}

// Primer valor no vacío para alguno de los nombres de campo, en cualquier objeto.
function firstField(cache, names) {
  for (const obj of Object.values(cache)) {
    if (!obj || typeof obj !== "object") continue;
    for (const n of names) {
      const v = obj[n];
      if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) return v;
    }
  }
  return null;
}

function normalizeGenres(g) {
  if (!g) return [];
  return [].concat(g).map(x => (typeof x === "string" ? x : x?.value || x?.name)).filter(Boolean).slice(0, 6);
}

function longestDescription(cache) {
  let best = "";
  const fields = ["longDescription", "description", "shortDescription", "conceptDescription", "localizedLongDescription"];
  for (const obj of Object.values(cache)) {
    if (!obj || typeof obj !== "object") continue;
    for (const f of fields) {
      if (typeof obj[f] === "string") {
        const clean = decodeEntities(stripTags(obj[f])).trim();
        if (clean.length > best.length) best = clean;
      }
    }
  }
  return best;
}

// Diagnóstico: resume la estructura real del apolloState de PSN para poder ajustar
// la extracción sin acceso directo a la tienda. /api/cover?psnDebug=<titulo>
function debugPsn(html, psnId) {
  const out = { psnId, htmlLen: html ? html.length : 0, hasNextData: false, typenames: {}, mediaRoles: {}, mediaTypes: {}, sampleMedia: [], descFields: {}, sampleKeys: [] };
  const ogd = html && html.match(/<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  out.ogDescription = ogd ? ogd[1].slice(0, 160) : "";
  const cache = parseApolloState(html || "");
  if (!cache) return out;
  out.hasNextData = true;
  out.sampleKeys = Object.keys(cache).slice(0, 40);
  for (const [k, obj] of Object.entries(cache)) {
    if (!obj || typeof obj !== "object") continue;
    const tn = obj.__typename || k.split(":")[0] || "?";
    out.typenames[tn] = (out.typenames[tn] || 0) + 1;
    if (Array.isArray(obj.media)) {
      for (const item of obj.media) {
        const m = item?.__ref ? cache[item.__ref] : item;
        if (!m) continue;
        if (m.role) out.mediaRoles[m.role] = (out.mediaRoles[m.role] || 0) + 1;
        if (m.type) out.mediaTypes[m.type] = (out.mediaTypes[m.type] || 0) + 1;
        if (out.sampleMedia.length < 10 && m.url) out.sampleMedia.push({ role: m.role || null, type: m.type || null, url: String(m.url).slice(0, 90) });
      }
    }
    for (const f of ["longDescription", "description", "shortDescription", "conceptDescription"]) {
      if (typeof obj[f] === "string") out.descFields[f] = Math.max(out.descFields[f] || 0, obj[f].length);
    }
  }
  // Descripción detectada + resumen de los bloques JSON-LD (para confirmar fuente).
  out.detectedDescription = extractMetaDescription(html).slice(0, 220);
  out.jsonLd = [];
  for (const block of (html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(block[1].trim());
      const nodes = Array.isArray(ld) ? ld : (ld["@graph"] || [ld]);
      for (const n of [].concat(nodes)) {
        out.jsonLd.push({ type: n["@type"] || null, hasDesc: typeof n.description === "string", descLen: (n.description || "").length, keys: Object.keys(n || {}).slice(0, 16) });
      }
    } catch { out.jsonLd.push({ parseError: true }); }
  }
  return out;
}

// Busca un título en PSN y devuelve el primer ID de producto (para el modo debug).
async function psnSearchFirstId(title) {
  const url = `${PSN_BASE}/search/${encodeURIComponent(title)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-CR,es;q=0.9,en;q=0.8" } });
  if (!r.ok) return "";
  const cache = parseApolloState(await r.text());
  if (!cache) return "";
  for (const obj of Object.values(cache)) {
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename === "Product" && obj.id) return obj.id;
    if (typeof obj.id === "string" && /^[A-Z]{2}\d/.test(obj.id)) return obj.id;
  }
  return "";
}

// Descripción en español del HTML: JSON-LD (Product/VideoGame) primero —suele ser
// la descripción larga—, luego og:description / twitter:description (sin depender
// del orden de los atributos del <meta>).
function extractMetaDescription(html) {
  if (!html) return "";
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(block[1].trim());
      const nodes = Array.isArray(ld) ? ld : (ld["@graph"] || [ld]);
      for (const n of [].concat(nodes)) {
        if (n && typeof n.description === "string" && n.description.trim().length > 20) {
          return decodeEntities(stripTags(n.description)).trim();
        }
      }
    } catch { /* sigo */ }
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (/(?:property|name)=["'](?:og:description|twitter:description|description)["']/i.test(tag)) {
      const c = tag.match(/content=["']([^"']*)["']/i);
      if (c && c[1].trim().length > 20) return decodeEntities(c[1]).trim();
    }
  }
  return "";
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ─── Vandal (respaldo de ficha en español) ─────────────────────────────────────
//
// Vandal no tiene API pública: 1) buscamos el juego, 2) probamos los primeros
// resultados, 3) usamos SOLO el que su título coincida con el buscado (evita
// matches errados), 4) extraemos descripción/capturas vía JSON-LD. NO usamos
// og:image como captura: en Vandal es una tarjeta para compartir (pixelada).
// NOTA: la URL de búsqueda puede requerir ajuste contra el sitio real.
const VANDAL_BASE = "https://vandal.elespanol.com";

async function fetchVandalFicha(title) {
  const out = emptyFicha("");
  const candidates = await findVandalPages(title);
  for (const pageUrl of candidates) {
    let html;
    try {
      const r = await fetch(pageUrl, { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      html = await r.text();
    } catch { continue; }

    // Verificar que la página corresponde al juego buscado (evita "Fatekeeper"
    // y otros destacados no relacionados que el buscador pueda devolver).
    const pageTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<title>([^<]+)<\/title>/i)?.[1] || "");
    if (!titlesMatch(title, pageTitle)) continue;

    // JSON-LD (schema VideoGame) — única fuente confiable de capturas reales.
    for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi)) {
      try {
        const ld = JSON.parse(block[1].trim());
        const node = Array.isArray(ld) ? ld.find(x => /VideoGame|Game/i.test(x["@type"] || "")) : ld;
        if (!node) continue;
        if (node.description) out.description = decodeEntities(stripTags(node.description)).trim();
        if (node.genre) out.genres = normalizeGenres(node.genre);
        if (node.publisher) out.publisher = (typeof node.publisher === "string" ? node.publisher : node.publisher?.name) || "";
        if (node.image) out.screenshots = [].concat(node.image).map(i => (typeof i === "string" ? i : i?.url)).filter(Boolean).slice(0, 6);
        if (node.datePublished) out.released = String(node.datePublished).slice(0, 10);
      } catch { /* sigo */ }
    }

    // Descripción de respaldo (texto, NO imagen) si el JSON-LD no la trajo.
    if (!out.description) {
      const ogd = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
      if (ogd) out.description = decodeEntities(ogd[1]).trim();
    }
    if (out.description || out.screenshots.length) return out; // match válido
  }
  return out;
}

// Compara el título buscado con el de la página: inclusión o ≥60% de palabras.
function titlesMatch(a, b) {
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  if (B.includes(A) || A.includes(B)) return true;
  const aw = A.split(" ").filter(w => w.length > 2);
  if (!aw.length) return false;
  const bw = new Set(B.split(" "));
  return aw.filter(w => bw.has(w)).length / aw.length >= 0.6;
}

async function findVandalPages(title) {
  const q = encodeURIComponent(title.replace(/[™®©]/g, "").trim());
  const searchUrl = `${VANDAL_BASE}/busqueda?texto=${q}`;
  try {
    const r = await fetch(searchUrl, { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const html = await r.text();
    // Enlaces a fichas de juego (/juegos/<algo>/<algo> o /fichas/...). Pedimos al
    // menos dos segmentos para descartar páginas de categoría (/juegos/ps5).
    const links = [...html.matchAll(/href=["'](\/(?:juegos|fichas)\/[^"'#?]+\/[^"'#?]+)["']/gi)].map(m => m[1]);
    return [...new Set(links)].slice(0, 3).map(u => (u.startsWith("http") ? u : `${VANDAL_BASE}${u}`));
  } catch { return []; }
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
