// Scraper de PlayStation Store (es-cr) — v4 paginado + facetas.
//
// Recorre todas las páginas de la(s) categoría(s) principales de juegos
// PS5/PS4 hasta encontrar un chunk vacío, en paralelo controlado. Más
// las páginas estáticas de deals/latest. Antes traíamos ~200 juegos
// fijos; ahora apuntamos a varios miles.
//
// v4 añade las "facetas" que usa la propia PS Store para filtrar, leyendo
// los campos del Product de PSN:
//   • type        → full-game / bundle / edition / add-on
//   • releaseDate → fecha de lanzamiento
//   • comingSoon  → releaseDate en el futuro (va a la sección de Preventa)
//   • ageRating   → clasificación por edad
// Y EXCLUYE los add-on (DLC): el negocio no los vende.
//
// Si PSN cambia el UUID de la categoría o el patrón /category/{id}/{n},
// hay que actualizar CATEGORIES/STATIC_PAGES abajo.
//
// Diagnóstico (para confirmar nombres de campo reales contra PSN en vivo):
//   GET /api/scrape?debug=classification

const PSN_BASE = "https://store.playstation.com/es-cr";

const CATEGORIES = [
  "44d8bb20-653e-431e-8ad0-c0a365f68d2f", // Catálogo PS5/PS4 principal
];

const STATIC_PAGES = [
  "/pages/deals",
  "/pages/latest",
  "/pages/coming-soon", // preventas / próximos lanzamientos
];

// Búsquedas por género — usamos el buscador de PSN como "discovery" de
// géneros. Cada query trae ~24-48 juegos clasificados en ese género por
// PSN. Después taggeamos cada juego del catálogo con sus géneros para
// que cuando el usuario escriba "terror" en la búsqueda interna también
// le aparezcan los juegos de terror, no solo los que tengan "terror" en
// el título.
//
// Los tags están normalizados (sin tilde, minúsculas) para matchear
// fácil contra la búsqueda del cliente. La query usa español porque la
// tienda es es-cr y devuelve resultados más relevantes.
const GENRE_SEARCHES = [
  { tag: "accion",     query: "acción" },
  { tag: "aventura",   query: "aventura" },
  { tag: "terror",     query: "terror" },
  { tag: "rpg",        query: "rpg" },
  { tag: "deportes",   query: "deportes" },
  { tag: "carreras",   query: "carreras" },
  { tag: "shooter",    query: "shooter" },
  { tag: "lucha",      query: "lucha" },
  { tag: "estrategia", query: "estrategia" },
  { tag: "infantiles", query: "infantil" },
];

// Descubrimiento de PREVENTAS para la sección de Reservaciones. La categoría
// principal del catálogo casi no expone los juegos que todavía no salieron, así
// que le preguntamos al buscador de PSN directamente por la etiqueta "preventa"
// (la misma que usa la tienda para los próximos lanzamientos). Todo lo que venga
// de acá se marca como comingSoon = true aunque la vista de búsqueda no traiga
// la fecha en el apolloState, porque por definición son títulos en preventa.
const COMING_SOON_SEARCHES = ["preventa"];

// Señales de "próximamente / preventa" por texto. PSN a veces no expone la
// releaseDate en las vistas de lista, pero sí una etiqueta o texto de
// disponibilidad. Las detectamos para no perder preventas.
const COMING_SOON_TEXT_RE = /preventa|pre-?venta|pr[oó]ximamente|coming soon|pre-?order|pre-?orden|disponible el|available (from|on)/i;

// Tope de páginas por categoría. 150 * ~24 productos = ~3600 por categoría.
// La corrida anterior llegó a 50 sin ningún empty/fail, así que el catálogo
// tiene bastante más profundidad que eso.
const MAX_PAGES_PER_CATEGORY = 150;
// Cuántas páginas pedimos en paralelo dentro de una misma categoría.
// Subimos a 20 para que 150 páginas entren dentro del timeout de 30s
// (8 chunks * ~2.5s ≈ 20s).
const PAGE_CHUNK = 20;

// ── Clasificación del producto (facetas tipo PS Store) ───────────────────────
// PSN expone la clasificación en `storeDisplayClassification` (FULL_GAME,
// GAME_BUNDLE, PREMIUM_EDITION, ADD_ON, …). Como distintas vistas/regiones la
// exponen con nombres distintos, probamos varios y, si no hay ninguno, inferimos
// por el título (conservador: ante la duda dejamos el juego, nunca lo borramos).
const ADDON_TITLE_RE = /pase de temporada|season pass|expansion pass|pase de expansi[oó]n|paquete de (monedas|divisas|puntos|cr[eé]ditos|gemas)|\b\d{2,}\s*(monedas|cr[eé]ditos|puntos|v-?bucks|gemas)\b|contenido adicional|complemento\b|\bdlc\b|\badd[\s-]?on\b/i;
const EDITION_TITLE_RE = /\b(ultimate|deluxe|gold|premium|definitive|complete|collector'?s?|legendary|legacy|goty|game of the year|digital deluxe)\b|\bedici[oó]n\b|\bedition\b|\bbundle\b|\btrilog(y|[ií]a)\b|\bcollection\b|\bcolecci[oó]n\b/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Diagnóstico de campos: confirma contra PSN en vivo qué campo trae la
  //    clasificación (type) y la clasificación por edad, sin adivinar.
  if ((req.query.debug || "") === "classification") {
    try {
      return res.status(200).json(await debugClassification());
    } catch (e) {
      return res.status(200).json({ error: e.message });
    }
  }

  try {
    const map = new Map();
    const genreMap = new Map();    // gameId -> Set<genreTag>
    const newIds = new Set();      // ids que aparecen en /pages/latest -> "estreno"
    const comingSoonIds = new Set(); // ids del descubrimiento de preventas -> "preventa"
    const stats = {
      categoriesScanned: CATEGORIES.length,
      pagesFetched: 0,
      pagesEmpty: 0,
      pagesFailed: 0,
      genresFetched: 0,
      genresFailed: 0,
      addonsExcluded: 0,
    };

    const categoryWork = CATEGORIES.map(async (catId) => {
      const items = await fetchCategoryPaginated(catId, stats);
      for (const g of items) {
        if (!map.has(g.id)) map.set(g.id, g);
      }
    });

    const staticWork = STATIC_PAGES.map(async (path) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}${path}`, stats);
        stats.pagesFetched++;
        const isLatest = path.includes("latest");
        const isComingSoonPage = path.includes("coming-soon");
        for (const g of games) {
          if (isComingSoonPage) {
            // Todo lo de esta página ES preventa por definición
            g.comingSoon = true;
            comingSoonIds.add(g.id);
          }
          if (!map.has(g.id)) map.set(g.id, g);
          else if (isComingSoonPage) map.set(g.id, { ...map.get(g.id), comingSoon: true });
          if (isLatest) newIds.add(g.id);
        }
      } catch {
        stats.pagesFailed++;
      }
    });

    const genreWork = GENRE_SEARCHES.map(async ({ tag, query }) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`, stats);
        stats.genresFetched++;
        for (const g of games) {
          if (!genreMap.has(g.id)) genreMap.set(g.id, new Set());
          genreMap.get(g.id).add(tag);
        }
      } catch {
        stats.genresFailed++;
      }
    });

    const comingSoonWork = COMING_SOON_SEARCHES.map(async (query) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`, stats);
        for (const g of games) {
          if (!map.has(g.id)) map.set(g.id, g);
          comingSoonIds.add(g.id);
        }
      } catch {
        stats.genresFailed++;
      }
    });

    await Promise.all([...categoryWork, ...staticWork, ...genreWork, ...comingSoonWork]);

    let taggedDirect = 0;
    let taggedSearch = 0;
    const sampleTagged = [];

    const games = Array.from(map.values())
      .map(g => {
        const direct = new Set(g.directGenres || []);
        const search = genreMap.get(g.id) || new Set();
        const merged = new Set([...direct, ...search]);
        // El descubrimiento de preventas (búsqueda "preventa" en PSN) marca el
        // juego como próximo a salir aunque la vista de lista no traiga la fecha.
        if (comingSoonIds.has(g.id)) g.comingSoon = true;
        // Facetas de merchandising (además del género), como etiquetas filtrables:
        if (g.type === "edition" || g.type === "bundle") merged.add("edicion");
        if (g.comingSoon) merged.add("preventa");
        else if (newIds.has(g.id)) merged.add("estreno");
        if (direct.size > 0) taggedDirect++;
        if (search.size > 0) taggedSearch++;
        if (merged.size > 0 && sampleTagged.length < 5) {
          sampleTagged.push({ title: g.title, genres: Array.from(merged) });
        }
        const { directGenres, ...rest } = g;
        return { ...rest, genres: Array.from(merged) };
      })
      .sort((a, b) => {
        if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
        return b.discount - a.discount;
      });

    stats.taggedDirect = taggedDirect;
    stats.taggedSearch = taggedSearch;
    stats.sampleTagged = sampleTagged;
    stats.comingSoon = games.filter(g => g.comingSoon).length;
    stats.editions = games.filter(g => g.type === "edition" || g.type === "bundle").length;

    return res.status(200).json({
      success: true,
      count: games.length,
      stats,
      games,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function fetchCategoryPaginated(catId, stats) {
  const all = [];
  let pageStart = 1;
  while (pageStart <= MAX_PAGES_PER_CATEGORY) {
    const pageNums = [];
    for (let i = 0; i < PAGE_CHUNK && pageStart + i <= MAX_PAGES_PER_CATEGORY; i++) {
      pageNums.push(pageStart + i);
    }
    const results = await Promise.allSettled(
      pageNums.map(p => fetchAndParse(`${PSN_BASE}/category/${catId}/${p}`, stats))
    );
    let chunkProduced = false;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.length > 0) {
          all.push(...r.value);
          stats.pagesFetched++;
          chunkProduced = true;
        } else {
          stats.pagesEmpty++;
        }
      } else {
        stats.pagesFailed++;
      }
    }
    // Si todo el chunk vino vacío o falló, asumimos que ya pasamos del final.
    if (!chunkProduced) break;
    pageStart += PAGE_CHUNK;
  }
  return all;
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.text();
}

async function fetchAndParse(url, stats) {
  return parseGames(await fetchHtml(url), stats);
}

function parseGames(html, stats) {
  if (!html || html.length < 500) return [];
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }

  const cache = data?.props?.apolloState || {};
  const deref = (val) =>
    val && typeof val === "object" && val.__ref ? (cache[val.__ref] ?? val) : val;

  const out = [];
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename === "Product" || (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id))) {
      const g = normalize({ ...obj, price: deref(obj.price), contentRating: deref(obj.contentRating) });
      if (g) out.push(g);
      else if (stats && g === null && classifyType(obj) === "add-on") stats.addonsExcluded++;
    }
  }
  return out;
}

function normalize(p) {
  if (!p.id || !p.name) return null;

  // Tipo de producto. El negocio NO vende DLC/add-ons → fuera del catálogo.
  const type = classifyType(p);
  if (type === "add-on") return null;

  // Detectamos preventa ANTES del filtro de precio: los juegos que todavía no
  // salieron pueden no tener precio en PSN y no deben ser descartados.
  const releaseDate = extractReleaseDate(p);
  const comingSoon = detectComingSoon(p, releaseDate);

  const priceInfo = p.price || {};
  const current = parsePrice(priceInfo.discountedPrice ?? priceInfo.discountedValue ?? priceInfo.basePrice);
  const original = parsePrice(priceInfo.basePrice) || current;
  // Sin precio Y no es preventa → lo descartamos (producto sin datos útiles).
  if (!current && !comingSoon) return null;

  let platform = "PS4";
  const plats = p.platforms || [];
  const hasPS5 = plats.includes("PS5") || /PS5/i.test(p.name);
  const hasPS4 = plats.includes("PS4");
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";

  const imageUrl = pickPsnCover(p.media);

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
    // Facetas tipo PS Store:
    type,                       // full-game | bundle | edition
    releaseDate,                // "YYYY-MM-DD" o ""
    comingSoon,                 // releaseDate en el futuro
    ageRating: extractAgeRating(p), // "Teen", "+18", etc. (mejor esfuerzo)
    isBundle: type === "bundle" || type === "edition",
    // Géneros desde el propio Product de PSN. Distintas páginas de PSN
    // exponen el campo con nombres distintos, así que probamos varios.
    // Lo que matchee se taggea con la versión normalizada (sin tildes,
    // minúsculas) para que la búsqueda interna del cliente lo encuentre.
    directGenres: extractDirectGenres(p),
  };
}

// Devuelve "full-game" | "bundle" | "edition" | "add-on".
function classifyType(p) {
  const raw = String(
    p.storeDisplayClassification ?? p.displayClassification ??
    p.topCategory ?? p.gameContentType ?? p.contentType ?? p.productType ?? ""
  ).toUpperCase();
  if (/ADD[\s_-]?ON|ADDON|\bDLC\b/.test(raw)) return "add-on";
  if (/BUNDLE/.test(raw)) return "bundle";
  if (/PREMIUM|EDITION/.test(raw)) return "edition";
  if (/FULL[\s_-]?GAME|PS[345][\s_-]?GAME|^GAME$|DIGITAL[\s_-]?FULL/.test(raw)) return "full-game";
  // Sin clasificación reconocible: inferimos por título (conservador).
  if (ADDON_TITLE_RE.test(p.name)) return "add-on";
  if (EDITION_TITLE_RE.test(p.name)) return "edition";
  return "full-game";
}

function extractReleaseDate(p) {
  const v = p.releaseDate ?? p.releaseDateText ?? p.originalReleaseDate ?? "";
  const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

function isFutureDate(ymd) {
  if (!ymd) return false;
  const t = Date.parse(ymd + "T00:00:00Z");
  return Number.isFinite(t) && t > Date.now();
}

// ¿El juego está en preventa / próximo a salir? Primero por fecha futura y,
// si PSN no la expuso en esta vista, por la etiqueta/texto de disponibilidad.
// Sólo miramos campos candidatos concretos (no todo el producto) para no
// generar falsos positivos con títulos que mencionen "preventa" por casualidad.
function detectComingSoon(p, releaseDate) {
  if (isFutureDate(releaseDate)) return true;
  const labels = [
    p.upsellText, p.availabilityText, p.topCategory, p.badge, p.callToAction,
    p?.price?.upsellText, p?.price?.serviceBranding, p?.price?.priceType,
  ];
  for (const v of labels) {
    if (v && COMING_SOON_TEXT_RE.test(String(v))) return true;
  }
  return false;
}

// Clasificación por edad (mejor esfuerzo: PSN la expone de formas distintas).
function extractAgeRating(p) {
  const cr = p.contentRating;
  if (cr && typeof cr === "object") {
    const v = cr.description || cr.name || cr.title || cr.ratingSystemId || cr.ageRatingText;
    if (v) return String(v).trim();
  }
  const v = p.ageRating ?? p.ratingDescription ?? "";
  return String(v || "").trim();
}

function extractDirectGenres(p) {
  const out = new Set();
  const fieldsToCheck = [p.genres, p.localizedGenres, p.genreList, p.localizedGenreNames];
  for (const src of fieldsToCheck) {
    if (!Array.isArray(src)) continue;
    for (const g of src) {
      const val = typeof g === "string" ? g : (g?.value || g?.name || g?.label);
      if (val) out.add(normalizeGenreTag(val));
    }
  }
  return Array.from(out);
}

// Elige la mejor imagen de portada del array `media` de un Product de PSN.
// MASTER es la key art principal (cuadrada). Si PSN cambia el esquema o no la
// trae, probamos roles de carátula alternativos y, por último, la primera
// imagen real — nunca un video (que rompería la portada).
function pickPsnCover(media) {
  if (!Array.isArray(media)) return "";
  const byRole = (role) => media.find(m => m && m.role === role && m.url)?.url;
  return (
    byRole("MASTER") ||
    byRole("GAMEHUB_COVER_ART") ||
    byRole("PORTRAIT") ||
    byRole("KEY_ART") ||
    media.find(m => m && (m.type === "IMAGE" || !m.type) && m.url)?.url ||
    ""
  );
}

function normalizeGenreTag(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parsePrice(str) {
  if (str == null) return 0;
  if (typeof str === "number") return str;
  const m = String(str).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

// ── Diagnóstico: trae una página real de PSN y reporta, para los primeros
//    productos, TODAS sus llaves + los valores de los campos candidatos. Sirve
//    para confirmar el nombre real del campo de "type" y de "age rating" sin
//    adivinar. /api/scrape?debug=classification
async function debugClassification() {
  const html = await fetchHtml(`${PSN_BASE}/category/${CATEGORIES[0]}/1`);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return { error: "sin __NEXT_DATA__" };
  const cache = JSON.parse(m[1])?.props?.apolloState || {};
  const deref = (v) => (v && typeof v === "object" && v.__ref ? cache[v.__ref] ?? v : v);

  const candidates = ["storeDisplayClassification", "displayClassification", "topCategory", "gameContentType", "contentType", "productType", "releaseDate", "ageRating", "ratingDescription"];
  const breakdown = {};
  const samples = [];
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename !== "Product" && !(typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id))) continue;
    const cls = obj.storeDisplayClassification ?? obj.displayClassification ?? obj.topCategory ?? "(sin campo)";
    breakdown[cls] = (breakdown[cls] || 0) + 1;
    if (samples.length < 8) {
      const picked = {};
      for (const c of candidates) if (obj[c] !== undefined) picked[c] = obj[c];
      samples.push({ id: obj.id, name: obj.name, detectedType: classifyType(obj), allKeys: Object.keys(obj), candidateValues: picked, contentRating: deref(obj.contentRating) });
    }
  }
  return { classificationBreakdown: breakdown, samples };
}
