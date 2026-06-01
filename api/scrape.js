// Scraper de PlayStation Store (es-cr) — v3 paginado.
//
// Recorre todas las páginas de la(s) categoría(s) principales de juegos
// PS5/PS4 hasta encontrar un chunk vacío, en paralelo controlado. Más
// las páginas estáticas de deals/latest. Antes traíamos ~200 juegos
// fijos; ahora apuntamos a varios miles.
//
// Si PSN cambia el UUID de la categoría o el patrón /category/{id}/{n},
// hay que actualizar CATEGORIES/STATIC_PAGES abajo.

const PSN_BASE = "https://store.playstation.com/es-cr";

const CATEGORIES = [
  "44d8bb20-653e-431e-8ad0-c0a365f68d2f", // Catálogo PS5/PS4 principal
];

const STATIC_PAGES = [
  "/pages/deals",
  "/pages/latest",
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

// Tope de páginas por categoría. 150 * ~24 productos = ~3600 por categoría.
// La corrida anterior llegó a 50 sin ningún empty/fail, así que el catálogo
// tiene bastante más profundidad que eso.
const MAX_PAGES_PER_CATEGORY = 150;
// Cuántas páginas pedimos en paralelo dentro de una misma categoría.
// Subimos a 20 para que 150 páginas entren dentro del timeout de 30s
// (8 chunks * ~2.5s ≈ 20s).
const PAGE_CHUNK = 20;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const map = new Map();
    const genreMap = new Map(); // gameId -> Set<genreTag>
    const stats = {
      categoriesScanned: CATEGORIES.length,
      pagesFetched: 0,
      pagesEmpty: 0,
      pagesFailed: 0,
      genresFetched: 0,
      genresFailed: 0,
    };

    const categoryWork = CATEGORIES.map(async (catId) => {
      const items = await fetchCategoryPaginated(catId, stats);
      for (const g of items) {
        if (!map.has(g.id)) map.set(g.id, g);
      }
    });

    const staticWork = STATIC_PAGES.map(async (path) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}${path}`);
        stats.pagesFetched++;
        for (const g of games) {
          if (!map.has(g.id)) map.set(g.id, g);
        }
      } catch {
        stats.pagesFailed++;
      }
    });

    const genreWork = GENRE_SEARCHES.map(async ({ tag, query }) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`);
        stats.genresFetched++;
        for (const g of games) {
          if (!genreMap.has(g.id)) genreMap.set(g.id, new Set());
          genreMap.get(g.id).add(tag);
        }
      } catch {
        stats.genresFailed++;
      }
    });

    await Promise.all([...categoryWork, ...staticWork, ...genreWork]);

    let taggedDirect = 0;
    let taggedSearch = 0;
    const sampleTagged = [];

    const games = Array.from(map.values())
      .map(g => {
        const direct = new Set(g.directGenres || []);
        const search = genreMap.get(g.id) || new Set();
        const merged = new Set([...direct, ...search]);
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
      pageNums.map(p => fetchAndParse(`${PSN_BASE}/category/${catId}/${p}`))
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

async function fetchAndParse(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  const html = await r.text();
  return parseGames(html);
}

function parseGames(html) {
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
      const g = normalize({ ...obj, price: deref(obj.price) });
      if (g) out.push(g);
    }
  }
  return out;
}

function normalize(p) {
  if (!p.id || !p.name) return null;
  const priceInfo = p.price || {};
  const current = parsePrice(priceInfo.discountedValue ?? priceInfo.basePrice);
  const original = parsePrice(priceInfo.basePrice) || current;
  if (!current) return null;

  let platform = "PS4";
  const plats = p.platforms || [];
  const hasPS5 = plats.includes("PS5") || /PS5/i.test(p.name);
  const hasPS4 = plats.includes("PS4");
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";

  let imageUrl = "";
  if (Array.isArray(p.media)) {
    const img = p.media.find(m => m.role === "MASTER") || p.media[0];
    if (img) imageUrl = img.url;
  }

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
    isBundle: /bundle|edition|collection|pack|trilogy|complete|deluxe|ultimate|gold|premium|definitive|remaster/i.test(p.name),
    // Géneros desde el propio Product de PSN. Distintas páginas de PSN
    // exponen el campo con nombres distintos, así que probamos varios.
    // Lo que matchee se taggea con la versión normalizada (sin tildes,
    // minúsculas) para que la búsqueda interna del cliente lo encuentre.
    directGenres: extractDirectGenres(p),
  };
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

function normalizeGenreTag(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parsePrice(str) {
  if (str == null) return 0;
  if (typeof str === "number") return str;
  const m = String(str).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
