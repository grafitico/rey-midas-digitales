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

// Categorías de género — cada género tiene su propio UUID en PSN, igual
// que el catálogo principal. Las paginamos y taggeamos cada juego que
// aparece con el género correspondiente. Esto es la fuente confiable de
// tags: el `directGenres` del Product no viene poblado en es-cr (corrida
// previa: 0 juegos taggeados directo de 3579), y la búsqueda /search/
// solo devuelve ~24-48 resultados por query (28 taggeados de 3579, 0.8%).
//
// UUIDs verificados en stores en-us/es-mx (clúster LATAM, mismos UUIDs
// para es-cr). Si PSN cambia un UUID hay que actualizar acá.
const GENRE_CATEGORIES = [
  { tag: "accion",     uuid: "298b428c-0c39-4ec8-abd5-237484e5a2ea" }, // Action
  { tag: "rpg",        uuid: "e0b1cde3-a7ea-4d7a-960a-fa5edbafae8f" }, // RPG
  { tag: "shooter",    uuid: "64ee024b-7644-468a-92c6-370269075d5c" }, // Shooter
  { tag: "deportes",   uuid: "b86f0f65-cf49-4f96-8cdd-3991ca17eadc" }, // Sports
  { tag: "carreras",   uuid: "f45ce6b0-61ef-4b78-94c3-048d81b07f98" }, // Racing
  { tag: "lucha",      uuid: "02e50754-377f-4546-9252-67cfebb2e5b0" }, // Fighting
  { tag: "terror",     uuid: "6ec578f6-d6b7-423c-8b93-14e14a5a43f2" }, // Horror
  { tag: "simulacion", uuid: "bb42a4e0-2d0e-40e5-9714-ae4e10320f24" }, // Simulation
  { tag: "infantiles", uuid: "9d30a9d8-1a3c-462d-865d-0be3f208e6d2" }, // Kids & Family
];

// Búsquedas por género adicionales — fallback liviano que cubre tags que
// no tienen categoría dedicada en PSN (aventura como tag separado,
// estrategia). Si encuentra un juego ya taggeado por categoría, suma
// el tag; no duplica.
const GENRE_SEARCHES = [
  { tag: "aventura",   query: "aventura" },
  { tag: "estrategia", query: "estrategia" },
];

// Búsquedas semilla — el catálogo principal viene ordenado por release
// date y entierra AAA clásicos (Crash, NFS, FIFA viejos, GTA, etc.)
// más allá de las 150 páginas que paginamos. Cada query trae 24-48
// resultados y los agrega al map principal aunque no estén en la
// categoría principal. Sin tags forzados — si el juego tiene tags
// vendrán de las categorías de género.
const SEED_SEARCHES = [
  "crash bandicoot", "need for speed", "fifa", "ea sports fc",
  "gta", "grand theft auto", "call of duty", "assassin's creed",
  "tomb raider", "spider-man", "uncharted", "god of war",
  "resident evil", "battlefield", "minecraft", "rocket league",
  "mortal kombat", "tekken", "street fighter", "the last of us",
  "metal gear", "dark souls", "elden ring", "horizon",
  "nba 2k", "madden", "wwe", "f1", "watch dogs", "far cry",
  "borderlands", "dragon ball", "naruto", "one piece",
  "lego", "ratchet", "gran turismo", "diablo",
];

// Tope de páginas por categoría. 150 * ~24 productos = ~3600 por categoría.
// La corrida anterior llegó a 50 sin ningún empty/fail, así que el catálogo
// tiene bastante más profundidad que eso.
const MAX_PAGES_PER_CATEGORY = 150;
// Cuántas páginas pedimos en paralelo dentro de una misma categoría.
// Subimos a 20 para que 150 páginas entren dentro del timeout de 30s
// (8 chunks * ~2.5s ≈ 20s).
const PAGE_CHUNK = 20;

// Topes para categorías de género — más bajos porque corren 9 en
// paralelo con el catálogo principal. 20 páginas * ~24 = ~480 juegos
// por género; cubre el grueso sin saturar a PSN ni desbordar timeout.
const MAX_PAGES_PER_GENRE = 20;
const GENRE_PAGE_CHUNK = 5;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const map = new Map();
    const categoryGenreMap = new Map(); // gameId -> Set<genreTag> (de categorías UUID)
    const searchGenreMap = new Map();   // gameId -> Set<genreTag> (de /search/)
    const stats = {
      categoriesScanned: CATEGORIES.length,
      pagesFetched: 0,
      pagesEmpty: 0,
      pagesFailed: 0,
      genreCategoriesFetched: 0,
      genreCategoriesFailed: 0,
      genrePagesFetched: 0,
      genreSearchesFetched: 0,
      genreSearchesFailed: 0,
      seedSearchesFetched: 0,
      seedSearchesFailed: 0,
    };

    const categoryWork = CATEGORIES.map(async (catId) => {
      const items = await fetchCategoryPaginated(catId, stats, MAX_PAGES_PER_CATEGORY, PAGE_CHUNK);
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

    // Opción C: paginar cada categoría de género de PSN y taggear.
    // Estos juegos también se agregan al map principal por si no
    // estaban en la categoría general.
    const genreCategoryWork = GENRE_CATEGORIES.map(async ({ tag, uuid }) => {
      try {
        const items = await fetchCategoryPaginated(
          uuid,
          { pagesFetched: 0, pagesEmpty: 0, pagesFailed: 0 }, // stats locales descartables
          MAX_PAGES_PER_GENRE,
          GENRE_PAGE_CHUNK,
          stats, // para incrementar genrePagesFetched
        );
        stats.genreCategoriesFetched++;
        for (const g of items) {
          if (!map.has(g.id)) map.set(g.id, g);
          if (!categoryGenreMap.has(g.id)) categoryGenreMap.set(g.id, new Set());
          categoryGenreMap.get(g.id).add(tag);
        }
      } catch {
        stats.genreCategoriesFailed++;
      }
    });

    const genreSearchWork = GENRE_SEARCHES.map(async ({ tag, query }) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`);
        stats.genreSearchesFetched++;
        for (const g of games) {
          if (!map.has(g.id)) map.set(g.id, g);
          if (!searchGenreMap.has(g.id)) searchGenreMap.set(g.id, new Set());
          searchGenreMap.get(g.id).add(tag);
        }
      } catch {
        stats.genreSearchesFailed++;
      }
    });

    // Búsquedas semilla — sólo expanden el catálogo, no taggean.
    const seedWork = SEED_SEARCHES.map(async (query) => {
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`);
        stats.seedSearchesFetched++;
        for (const g of games) {
          if (!map.has(g.id)) map.set(g.id, g);
        }
      } catch {
        stats.seedSearchesFailed++;
      }
    });

    await Promise.all([
      ...categoryWork,
      ...staticWork,
      ...genreCategoryWork,
      ...genreSearchWork,
      ...seedWork,
    ]);

    let taggedDirect = 0;
    let taggedCategory = 0;
    let taggedSearch = 0;
    let taggedAny = 0;
    const sampleTagged = [];

    const games = Array.from(map.values())
      .map(g => {
        const direct = new Set(g.directGenres || []);
        const fromCategory = categoryGenreMap.get(g.id) || new Set();
        const fromSearch = searchGenreMap.get(g.id) || new Set();
        const merged = new Set([...direct, ...fromCategory, ...fromSearch]);
        if (direct.size > 0) taggedDirect++;
        if (fromCategory.size > 0) taggedCategory++;
        if (fromSearch.size > 0) taggedSearch++;
        if (merged.size > 0) taggedAny++;
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
    stats.taggedCategory = taggedCategory;
    stats.taggedSearch = taggedSearch;
    stats.taggedAny = taggedAny;
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

async function fetchCategoryPaginated(catId, stats, maxPages, chunkSize, sharedStats) {
  const all = [];
  let pageStart = 1;
  while (pageStart <= maxPages) {
    const pageNums = [];
    for (let i = 0; i < chunkSize && pageStart + i <= maxPages; i++) {
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
          if (sharedStats) sharedStats.genrePagesFetched++;
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
    pageStart += chunkSize;
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
  const out = [];
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename === "Product" || (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id))) {
      const g = normalize(obj);
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
