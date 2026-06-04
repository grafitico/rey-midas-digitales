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

function emptyFicha(psnId) {
  return { coverUrl: "", description: "", publisher: "", developer: "", genres: [], released: "", screenshots: [], videoUrl: "", psnId };
}

// Ficha completa desde la página de producto de PS Store (es-cr → todo en español).
function extractPsnFicha(html, psnId) {
  const out = emptyFicha(psnId);
  if (!html || html.length < 500) return out;

  // Descripción base: og:description / meta description (siempre presente, en español).
  const og = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i);
  if (og) out.description = decodeEntities(og[1]).trim();

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return out;
  let data;
  try { data = JSON.parse(m[1]); } catch { return out; }
  const cache = data?.props?.apolloState || {};

  // Localizar el Product principal (id exacto, o el que tenga el media más rico).
  let product = null;
  for (const obj of Object.values(cache)) {
    if (!obj || typeof obj !== "object") continue;
    const isProduct = obj.__typename === "Product" || String(obj.id || "").match(/^[A-Z]{2}\d/);
    if (!isProduct) continue;
    if (psnId && obj.id === psnId) { product = obj; break; }
    if (!product && Array.isArray(obj.media) && obj.media.length) product = obj;
  }
  if (!product) return out;

  const media = (Array.isArray(product.media) ? product.media : [])
    .map(x => (x?.__ref ? cache[x.__ref] : x)).filter(Boolean);

  out.coverUrl = pickPsnCover(media);

  // Capturas: rol SCREENSHOT; si no hay, cualquier IMAGE que no sea la carátula.
  const coverRoles = new Set(["MASTER", "GAMEHUB_COVER_ART", "PORTRAIT", "KEY_ART", "BACKGROUND"]);
  let shots = media.filter(x => x.role === "SCREENSHOT" && x.url).map(x => x.url);
  if (!shots.length) {
    shots = media.filter(x => (x.type === "IMAGE" || !x.type) && x.url && !coverRoles.has(x.role)).map(x => x.url);
  }
  out.screenshots = [...new Set(shots)].slice(0, 6);

  // Video de preview/gameplay (mp4 servido por PSN).
  const vid = media.find(x => (x.type === "VIDEO" || x.role === "PREVIEW") && x.url);
  if (vid?.url) out.videoUrl = vid.url;

  // Metadatos.
  out.publisher = product.publisherName || product.providerName || "";
  const genres = product.localizedGenres || product.genres || [];
  out.genres = (Array.isArray(genres) ? genres : [])
    .map(g => (typeof g === "string" ? g : g?.value || g?.name)).filter(Boolean).slice(0, 6);
  const rel = product.releaseDate || product.releaseDateText || "";
  out.released = rel ? String(rel).slice(0, 10) : "";

  // Descripción larga si el Product la trae como campo de texto.
  for (const field of ["longDescription", "description", "shortDescription"]) {
    const v = product[field];
    if (typeof v === "string" && v.trim().length > out.description.length) {
      out.description = decodeEntities(stripTags(v)).trim();
    }
  }
  return out;
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
// Vandal no tiene API pública, así que: 1) buscamos el juego, 2) tomamos el primer
// resultado que sea una ficha de juego, 3) extraemos descripción e imágenes vía
// Open Graph / JSON-LD (más estable que parsear el HTML interno).
// NOTA: las URLs/selectores de Vandal pueden requerir ajuste contra el sitio real.
const VANDAL_BASE = "https://vandal.elespanol.com";

async function fetchVandalFicha(title) {
  const out = emptyFicha("");
  const pageUrl = await findVandalPage(title);
  if (!pageUrl) return out;

  const r = await fetch(pageUrl, {
    headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" },
  });
  if (!r.ok) return out;
  const html = await r.text();

  // 1) JSON-LD (schema VideoGame) si Vandal lo expone.
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(block[1].trim());
      const node = Array.isArray(ld) ? ld.find(x => /VideoGame|Game|Product/i.test(x["@type"] || "")) : ld;
      if (node) {
        if (node.description) out.description = decodeEntities(stripTags(node.description)).trim();
        if (node.genre) out.genres = [].concat(node.genre).filter(Boolean).slice(0, 6);
        if (node.publisher) out.publisher = (typeof node.publisher === "string" ? node.publisher : node.publisher?.name) || "";
        if (node.image) out.screenshots = [].concat(node.image).map(i => (typeof i === "string" ? i : i?.url)).filter(Boolean).slice(0, 6);
        if (node.datePublished) out.released = String(node.datePublished).slice(0, 10);
      }
    } catch { /* sigo con OG */ }
  }

  // 2) Open Graph como respaldo de la descripción/imagen.
  if (!out.description) {
    const ogd = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (ogd) out.description = decodeEntities(ogd[1]).trim();
  }
  if (!out.screenshots.length) {
    const ogi = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogi) out.screenshots = [ogi[1]];
  }
  return out;
}

async function findVandalPage(title) {
  const q = encodeURIComponent(title.replace(/[™®©]/g, "").trim());
  // Buscador de Vandal. Si cambia el patrón, ajustar acá.
  const searchUrl = `${VANDAL_BASE}/busqueda?texto=${q}`;
  try {
    const r = await fetch(searchUrl, { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" } });
    if (!r.ok) return "";
    const html = await r.text();
    // Primer enlace a una ficha de juego (/juegos/ o /fichas/).
    const m = html.match(/href=["'](\/(?:juegos|fichas)\/[^"']+)["']/i);
    if (m) return m[1].startsWith("http") ? m[1] : `${VANDAL_BASE}${m[1]}`;
  } catch { /* sin resultado */ }
  return "";
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
