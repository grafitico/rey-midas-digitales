// Scraper de PlayStation Store (es-cr) — v5: catálogo por GraphQL.
//
// Hasta el 2026-08-12 el catálogo de las categorías principales (PS4/PS5) se
// leía del HTML servido por PSN (__NEXT_DATA__ → apolloState). Ese día PSN
// rediseñó la tienda: el HTML inicial ya no trae los productos, el propio
// navegador los pide después, a mano, contra una API GraphQL interna
// (web.np.playstation.com/api/graphql/v1/op, operación categoryGridRetrieve
// con persisted query). `fetchCategoryGridPaginated` reproduce esa llamada
// directamente — más simple y rápido que el HTML (PSN devuelve el total
// exacto de resultados, así que no hay que "probar hasta que venga vacío").
//
// Lo que SÍ sigue viniendo del HTML clásico (fetchAndParse/normalize más
// abajo) porque no se recapturó su llamada GraphQL: las páginas estáticas de
// deals/latest, las búsquedas por género, las preventas y el browse general
// en-us. Si esas también se rompieron con el rediseño, siguen fallando en
// silencio (try/catch) como ya hacían — no bloquean el catálogo principal.
//
// v4 (histórico) añadió las "facetas" tipo PS Store leyendo el Product de
// PSN: type (full-game/bundle/edition/add-on), releaseDate, comingSoon,
// ageRating. La ruta GraphQL nueva no expone releaseDate/ageRating/género
// por producto todavía — solo type/precio/plataformas/portada.
//
// Si PSN vuelve a romper esto: recapturar la llamada abriendo
// store.playstation.com en el navegador, DevTools → Network → filtrar
// "graphql", recargar, y copiar la Request URL de categoryGridRetrieve (trae
// el operationName, variables y el sha256Hash nuevo en la URL).
//
// Diagnóstico rápido: GET /api/scrape?debug=gqltest (catálogo nuevo)
//                      GET /api/scrape?debug=classification (HTML clásico)

export const PSN_BASE = "https://store.playstation.com/es-cr";

// Tienda de la que leemos las PREVENTAS. La categoría de próximos lanzamientos
// existe (con juegos) en la tienda de EE.UU. (en-us); en es-cr (Costa Rica) esa
// categoría viene VACÍA. Los juegos son los mismos a nivel mundial (mismo ID de
// producto), así que descubrimos las preventas en en-us. Confirmado en vivo:
// es-cr devolvía 0 juegos, por eso la sección de Reservaciones estaba vacía.
export const COMING_SOON_BASE = "https://store.playstation.com/en-us";

// ─── IGDB (Twitch) — enriquece portadas faltantes al final del scrape ─────────
const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID || "";
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || "";
let _igdbToken = null;

export const CATEGORIES = [
  "44d8bb20-653e-431e-8ad0-c0a365f68d2f", // Catálogo principal (mayormente PS4/CUSA)
];

// Categoría "All PS5 Games" de PSN (d71e8e6d…). La categoría principal de arriba
// es casi toda PS4 (códigos CUSA); los juegos PS5 modernos (códigos PPSA: MK1,
// 007 First Light, etc.) viven en esta. NO se agrega a CATEGORIES porque el
// scrape en vivo de Vercel (30s) no alcanza a paginar dos catálogos grandes;
// la usa SOLO el sync de GitHub Actions (sin timeout) para cobertura PS5 total.
export const PS5_CATEGORY = "d71e8e6d-0940-4e03-bd02-404fc7d31a31";

// Categorías de PSN que son 100% "próximos lanzamientos". Todo lo que venga
// de aquí se trata como comingSoon=true sin importar si tiene precio o fecha.
// UUID de: store.playstation.com/en-us/category/82ced94c-ed3f-4d81-9b50-4d4cf1da170b
const COMING_SOON_CATEGORIES = [
  "82ced94c-ed3f-4d81-9b50-4d4cf1da170b",
];

const STATIC_PAGES = [
  "/pages/deals",
  "/pages/latest",
];

// Páginas de browse general de PSN (en-us). Capturan juegos que no aparecen
// en la categoría principal: precio bajo ($2–$5), precio alto ($60–$100) y otros.
// Se leen desde en-us (igual que las preventas) porque la cobertura es mayor.
// Las primeras 5 páginas son ~120 juegos; se mergean por ID sin duplicados.
export const BROWSE_PAGES_COUNT = 5;

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
export const GENRE_SEARCHES = [
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

// Búsqueda de PREVENTAS como fuente secundaria (la principal es la categoría
// de próximos lanzamientos en en-us). Se consulta en en-us con término en
// inglés porque "preventa" en es-cr devolvió 0 resultados (confirmado en vivo).
// Todo lo que venga de acá se marca comingSoon=true.
const COMING_SOON_SEARCHES = ["pre-order"];

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
const ADDON_TITLE_RE = /pase de temporada|season pass|expansion pass|pase de expansi[oó]n|paquete de (monedas|divisas|puntos|cr[eé]ditos|gemas)|\b\d{2,}\s*(monedas|cr[eé]ditos|puntos|v-?bucks|gemas)\b|contenido adicional|complemento\b|\bdlc\b|\badd[\s-]?on\b|pre-?order bonus|bonus pack|\b(cosmetic|skin|booster|starter|character|costume|currency|upgrade|content|weapon|outfit|avatar)\s+pack\b|paquete de (bonificaci[oó]n|preventa|contenido|cosm[eé]ticos)/i;
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

  // ── Diagnóstico de PREVENTAS: rápido y legible. Sólo consulta las fuentes de
  //    "próximos lanzamientos" (sin recorrer el catálogo completo), para que el
  //    dueño pueda abrir /api/scrape?debug=comingsoon en el navegador y ver al
  //    instante cuántas preventas encuentra PSN y de qué fuente vienen.
  if ((req.query.debug || "") === "comingsoon") {
    try {
      return res.status(200).json(await debugComingSoon());
    } catch (e) {
      return res.status(200).json({ error: e.message });
    }
  }

  // ── Diagnóstico: prueba en vivo la llamada GraphQL de categoryGridRetrieve
  //    (la fuente real del catálogo desde agosto 2026) y devuelve un resumen
  //    corto — no el JSON crudo — para confirmar rápido si sigue funcionando
  //    o si PSN volvió a rotar el hash de la persisted query.
  //    /api/scrape?debug=gqltest
  if ((req.query.debug || "") === "gqltest") {
    try {
      const raw = await fetchCategoryGridGql(CATEGORIES[0], 0, 3);
      const grid = raw?.data?.categoryGridRetrieve;
      return res.status(200).json({
        ok: !!grid,
        totalCount: grid?.pageInfo?.totalCount ?? null,
        sample: (grid?.products || []).map(p => ({
          id: p.id, name: p.name, platforms: p.platforms,
          basePrice: p.price?.basePrice, discountedPrice: p.price?.discountedPrice,
          classification: p.storeDisplayClassification,
        })),
      });
    } catch (e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  // ── Diagnóstico temporal (2026-08): prueba si categoryGridRetrieve acepta
  //    filterBy con las keys de facetOptions (para tagear género sin una
  //    persisted query nueva) y si la categoría de preventas responde igual
  //    sin el locale en-us. /api/scrape?debug=gqlfilter
  if ((req.query.debug || "") === "gqlfilter") {
    try {
      // Confirmado: filterBy = ["productGenres:ACTION"] (totalCount 2605,
      // coincide exacto con la faceta). Traemos la lista COMPLETA de géneros
      // (key + displayName en español, ya localizado por PSN) para tagear
      // sin mantener una lista fija a mano.
      const sizeR = await Promise.all([24, 100, 300].map(async (size) => {
        try {
          const r = await fetchCategoryGridGql(CATEGORIES[0], 0, size, ["productGenres:ACTION"]);
          const g = r?.data?.categoryGridRetrieve;
          return { size, ok: true, productsReturned: (g?.products || []).length };
        } catch (e) {
          return { size, ok: false, error: e.message };
        }
      }));
      const first = await fetchCategoryGridGql(CATEGORIES[0], 0, 1);
      const genreFacet = (first?.data?.categoryGridRetrieve?.facetOptions || []).find(f => f.name === "productGenres");
      return res.status(200).json({ sizeAttempts: sizeR, genres: genreFacet?.values || [] });
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
      pcExcluded: 0,
      igdbEnriched: 0,
      browsePages: 0,
      browseFound: 0,
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
        const games = await fetchAndParse(`${COMING_SOON_BASE}/search/${encodeURIComponent(query)}`, stats, { forceComingSoon: true });
        for (const g of games) {
          g.comingSoon = true;
          if (!map.has(g.id)) map.set(g.id, g);
          comingSoonIds.add(g.id);
        }
      } catch {
        stats.genresFailed++;
      }
    });

    // Categoría dedicada de "próximos lanzamientos" en PSN. A diferencia del
    // catálogo normal, esta categoría trae los juegos bajo `concepts` (no
    // `products`) — GTA VI, EA Sports FC, etc. son Concept con uno o más SKU
    // de preventa colgando. Confirmado que responde igual sin el locale
    // en-us: el propio ID de categoría ya acota la región.
    const comingSoonCatWork = COMING_SOON_CATEGORIES.map(async (catId) => {
      const items = await fetchComingSoonConcepts(catId, stats);
      for (const g of items) {
        comingSoonIds.add(g.id);
        if (!map.has(g.id)) map.set(g.id, g);
        else map.set(g.id, { ...map.get(g.id), comingSoon: true, imageUrl: map.get(g.id).imageUrl || g.imageUrl });
      }
    });

    // Páginas de browse general (en-us) — captura juegos que la categoría principal omite.
    const browseWork = Array.from({ length: BROWSE_PAGES_COUNT }, (_, i) => i + 1).map(async (n) => {
      try {
        const games = await fetchAndParse(`${COMING_SOON_BASE}/pages/browse/${n}`, stats);
        stats.browsePages++;
        for (const g of games) {
          if (!map.has(g.id)) {
            map.set(g.id, g);
            stats.browseFound++;
          }
        }
      } catch {
        stats.pagesFailed++;
      }
    });

    await Promise.all([...categoryWork, ...staticWork, ...genreWork, ...comingSoonWork, ...comingSoonCatWork, ...browseWork]);

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

    // Enriquecer con IGDB las portadas faltantes (preventas primero, hasta 25 juegos).
    // Solo corre si las credenciales IGDB están configuradas en Vercel.
    if (IGDB_CLIENT_ID && IGDB_CLIENT_SECRET) {
      await enrichWithIgdb(games, stats);
    }

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

// Categorías de la propia tienda es-cr (donde capturamos la persisted query
// de categoryGridRetrieve): van por GraphQL directo, mucho más rápido y ya
// no depende del HTML. Categorías de OTRA tienda (ej. "próximos lanzamientos"
// en en-us) siguen por el scraping HTML clásico, porque esa llamada GraphQL
// no lleva el locale en la URL (el navegador lo resuelve por cookie/header
// que no replicamos) y no confirmamos que devuelva el catálogo de esa región.
export async function fetchCategoryPaginated(catId, stats, opts = {}) {
  const base = opts.base || PSN_BASE;
  if (base !== PSN_BASE) return fetchCategoryPaginatedHtml(catId, stats, opts);
  return fetchCategoryGridPaginated(catId, stats, opts);
}

async function fetchCategoryPaginatedHtml(catId, stats, opts = {}) {
  const all = [];
  const maxPages = opts.maxPages || MAX_PAGES_PER_CATEGORY;
  const base = opts.base || PSN_BASE;
  // chunkSize/delayMs permiten al sync de GitHub Actions ir más lento (lotes
  // chicos + pausa) para no gatillar el rate-limit 403 de PSN. El scrape en
  // vivo de Vercel no los pasa → mantiene PAGE_CHUNK=20 sin pausa (rápido).
  const chunkSize = opts.chunkSize || PAGE_CHUNK;
  const delayMs = opts.delayMs || 0;
  let pageStart = 1;
  while (pageStart <= maxPages) {
    const pageNums = [];
    for (let i = 0; i < chunkSize && pageStart + i <= maxPages; i++) {
      pageNums.push(pageStart + i);
    }
    const results = await Promise.allSettled(
      pageNums.map(p => fetchAndParse(`${base}/category/${catId}/${p}`, stats, opts))
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
    pageStart += chunkSize;
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  return all;
}

// ── API real de PSN desde el cambio de agosto 2026: el catálogo de una
//    categoría ya no viene en el HTML (__NEXT_DATA__/apolloState quedó
//    vacío); el propio navegador lo pide, después de hidratar, a esta API
//    GraphQL con una "persisted query" (operación + hash capturados del
//    sitio real con DevTools el 2026-08-19). Si PSN rota el hash, esto vuelve
//    a devolver 0 juegos con `pagesFailed=0` — como el corte anterior — y
//    hay que recapturarlo desde el navegador (Network → filtrar "graphql").
const GQL_URL = "https://web.np.playstation.com/api/graphql/v1/op";
const CATEGORY_GRID_HASH = "88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03";
const CATEGORY_GRID_PAGE_SIZE = 24;

async function fetchCategoryGridGql(catId, offset, size = CATEGORY_GRID_PAGE_SIZE, filterBy = []) {
  const variables = { id: catId, pageArgs: { size, offset }, sortBy: null, filterBy, facetOptions: [] };
  const extensions = { persistedQuery: { version: 1, sha256Hash: CATEGORY_GRID_HASH } };
  const url = `${GQL_URL}?operationName=categoryGridRetrieve&variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
      "Referer": `${PSN_BASE}/category/${catId}/1`,
      "Origin": "https://store.playstation.com",
      // Apollo Server bloquea peticiones "simples" (sin preflight CORS) por
      // CSRF; estos headers fuerzan el preflight y no son form-urlencoded.
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": "categoryGridRetrieve",
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error(`GraphQL: ${json.errors[0]?.message || "error desconocido"}`);
  return json;
}

// Clasificación del producto vía el enum `storeDisplayClassification` que
// devuelve la propia API GraphQL (FULL_GAME, PREMIUM_EDITION, GAME_BUNDLE,
// ADD_ON, SOUNDTRACK, DEMO, GAME_APPLICATION…). El negocio no vende nada que
// no sea un juego completo/edición/bundle.
function classifyTypeGql(cls) {
  const raw = String(cls || "").toUpperCase();
  if (/ADD[_-]?ON|DLC/.test(raw)) return "add-on";
  if (/BUNDLE/.test(raw)) return "bundle";
  if (/PREMIUM|EDITION/.test(raw)) return "edition";
  if (/FULL[_-]?GAME/.test(raw)) return "full-game";
  if (/SOUNDTRACK|DEMO|APPLICATION/.test(raw)) return "add-on";
  return "full-game";
}

function normalizeGqlProduct(p) {
  if (!p || !p.id || !p.name) return null;
  const type = classifyTypeGql(p.storeDisplayClassification);
  if (type === "add-on") return null;

  const priceInfo = p.price || {};
  const isFree = !!priceInfo.isFree;
  const current = isFree ? 0 : parsePrice(priceInfo.discountedPrice);
  const original = isFree ? 0 : (parsePrice(priceInfo.basePrice) || current);
  if (!current && !isFree) return null;

  const plats = Array.isArray(p.platforms) ? p.platforms : [];
  const hasPS5 = plats.includes("PS5");
  const hasPS4 = plats.includes("PS4");
  if (plats.length > 0 && !hasPS5 && !hasPS4) return null;
  let platform = "PS4";
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";

  const onSale = original > current;
  return {
    id: p.id,
    title: p.name,
    platform,
    imageUrl: pickPsnCover(p.media),
    url: `https://store.playstation.com/es-cr/product/${p.id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
    type,
    // La API de grid no expone fecha de lanzamiento ni géneros por producto
    // (esos campos vivían en el HTML viejo); quedan vacíos hasta que se
    // capture la persisted query del buscador/preventas por separado.
    releaseDate: "",
    comingSoon: false,
    ageRating: "",
    isBundle: type === "bundle" || type === "edition",
    directGenres: [],
  };
}

// La categoría de "próximos lanzamientos" no trae `products` sino `concepts`
// (un juego con varias ediciones/SKUs de preventa agrupados). Tomamos el
// precio/portada del propio Concept y, de los SKUs colgados, inferimos
// plataforma por el prefijo del npTitleId (PPSA = PS5, CUSA = PS4/PS5 dual).
function normalizeGqlConcept(c) {
  if (!c || !c.id || !c.name) return null;
  const priceInfo = c.price || {};
  const isFree = !!priceInfo.isFree;
  const current = isFree ? 0 : parsePrice(priceInfo.discountedPrice);
  const original = isFree ? 0 : (parsePrice(priceInfo.basePrice) || current);

  const prodIds = (c.products || []).map(sku => sku.id).filter(Boolean);
  const hasPS5 = prodIds.some(id => /PPSA/i.test(id));
  const hasPS4 = prodIds.some(id => /CUSA/i.test(id));
  let platform = "PS5/PS4";
  if (hasPS5 && !hasPS4) platform = "PS5";
  else if (hasPS4 && !hasPS5) platform = "PS4";

  const onSale = original > current;
  return {
    id: `concept:${c.id}`,
    title: c.name,
    platform,
    imageUrl: pickPsnCover(c.media),
    url: prodIds[0]
      ? `https://store.playstation.com/es-cr/product/${prodIds[0]}`
      : `https://store.playstation.com/es-cr/concept/${c.id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
    type: "full-game",
    releaseDate: "",
    comingSoon: true,
    ageRating: "",
    isBundle: false,
    directGenres: [],
  };
}

// Trae la categoría de preventas completa (típicamente ~100-200 juegos, no
// miles) — mismo mecanismo de paginación por totalCount, pero leyendo
// `concepts` en vez de `products`.
async function fetchComingSoonConcepts(catId, stats) {
  const all = [];
  const size = CATEGORY_GRID_PAGE_SIZE;
  const push = (grid) => {
    if (!grid || !grid.concepts || !grid.concepts.length) { if (stats) stats.pagesEmpty++; return; }
    if (stats) stats.pagesFetched++;
    for (const c of grid.concepts) {
      const g = normalizeGqlConcept(c);
      if (g) all.push(g);
    }
  };
  let first;
  try {
    first = await fetchCategoryGridGql(catId, 0, size);
  } catch (e) {
    if (stats) stats.pagesFailed++;
    return all;
  }
  const grid = first?.data?.categoryGridRetrieve;
  push(grid);
  if (!grid) return all;

  const total = grid.pageInfo?.totalCount || 0;
  const offsets = [];
  for (let off = size; off < total; off += size) offsets.push(off);
  const results = await Promise.allSettled(offsets.map(off => fetchCategoryGridGql(catId, off, size)));
  for (const r of results) {
    if (r.status === "fulfilled") push(r.value?.data?.categoryGridRetrieve);
    else if (stats) stats.pagesFailed++;
  }
  return all;
}

// Pagina una categoría entera vía GraphQL: pide el primer bloque, lee el
// `totalCount` real que devuelve PSN y calcula de una todos los offsets que
// faltan (nada de "probar hasta que venga vacío" como con el HTML).
async function fetchCategoryGridPaginated(catId, stats, opts = {}) {
  const all = [];
  const size = CATEGORY_GRID_PAGE_SIZE;
  const chunkSize = opts.chunkSize || 12;
  const delayMs = opts.delayMs || 0;
  const maxItems = opts.maxPages ? opts.maxPages * size : Infinity;

  const track = (grid) => {
    if (!grid || !grid.products || !grid.products.length) { if (stats) stats.pagesEmpty++; return; }
    if (stats) stats.pagesFetched++;
    for (const p of grid.products) {
      const g = normalizeGqlProduct(p);
      if (g) all.push(g);
      else if (stats && classifyTypeGql(p.storeDisplayClassification) === "add-on") stats.addonsExcluded++;
    }
  };

  let first;
  try {
    first = await fetchCategoryGridGql(catId, 0, size);
  } catch (e) {
    if (stats) stats.pagesFailed++;
    return all;
  }
  const grid = first?.data?.categoryGridRetrieve;
  track(grid);
  if (!grid) return all;

  const total = Math.min(grid.pageInfo?.totalCount || 0, maxItems);
  const offsets = [];
  for (let off = size; off < total; off += size) offsets.push(off);

  for (let i = 0; i < offsets.length; i += chunkSize) {
    const batch = offsets.slice(i, i + chunkSize);
    const results = await Promise.allSettled(batch.map(off => fetchCategoryGridGql(catId, off, size)));
    for (const r of results) {
      if (r.status === "fulfilled") track(r.value?.data?.categoryGridRetrieve);
      else if (stats) stats.pagesFailed++;
    }
    if (delayMs) await new Promise(res => setTimeout(res, delayMs));
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

export async function fetchAndParse(url, stats, opts = {}) {
  return parseGames(await fetchHtml(url), stats, opts);
}

function parseGames(html, stats, opts = {}) {
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
      const g = normalize({ ...obj, price: deref(obj.price), contentRating: deref(obj.contentRating) }, opts);
      if (g) out.push(g);
      else if (stats && g === null) {
        if (classifyType(obj) === "add-on") stats.addonsExcluded++;
        else {
          const plats = obj.platforms || [];
          if (plats.length > 0 && !plats.some(pl => /^ps[2345]?\b|vita|playstation/i.test(String(pl)))) {
            stats.pcExcluded++;
          }
        }
      }
    }
  }
  return out;
}

function normalize(p, opts = {}) {
  if (!p.id || !p.name) return null;

  // Tipo de producto. El negocio NO vende DLC/add-ons → fuera del catálogo.
  const type = classifyType(p);
  if (type === "add-on") return null;

  // Detectamos preventa ANTES del filtro de precio: los juegos que todavía no
  // salieron pueden no tener precio en PSN y no deben ser descartados.
  const releaseDate = extractReleaseDate(p);
  // opts.forceComingSoon = true cuando el juego viene de una categoría de
  // "próximos lanzamientos" donde todos son preventas por definición.
  const comingSoon = opts.forceComingSoon || detectComingSoon(p, releaseDate);

  const priceInfo = p.price || {};
  const current = parsePrice(priceInfo.discountedPrice ?? priceInfo.discountedValue ?? priceInfo.basePrice);
  const original = parsePrice(priceInfo.basePrice) || current;
  // Sin precio Y no es preventa → lo descartamos (producto sin datos útiles).
  if (!current && !comingSoon) return null;

  let platform = "PS4";
  const plats = p.platforms || [];
  const hasPS5 = plats.includes("PS5") || /PS5/i.test(p.name);
  const hasPS4 = plats.includes("PS4");

  // Excluir si PSN reporta plataformas pero ninguna es PlayStation (ej. PC only, Xbox only…)
  if (plats.length > 0 && !hasPS5 && !hasPS4 &&
      !plats.some(pl => /^ps[2345]?\b|vita|playstation/i.test(String(pl)))) {
    return null;
  }

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

// ── Diagnóstico de PREVENTAS (/api/scrape?debug=comingsoon).
//    Consulta SOLO las fuentes de próximos lanzamientos y devuelve un resumen
//    legible: cuántas preventas encuentra y de qué fuente. Cada fuente se prueba
//    por separado para saber exactamente cuál funciona en la región es-cr.
async function debugComingSoon() {
  const out = { fuenteUsada: COMING_SOON_BASE, sources: {}, totalUnicos: 0, titulos: [] };
  const seen = new Map();

  const probe = async (label, url, force) => {
    try {
      const games = await fetchAndParse(url, null, { forceComingSoon: force });
      const list = force ? games : games.filter(g => g.comingSoon);
      out.sources[label] = { url, ok: true, encontrados: games.length, preventas: list.length };
      for (const g of list) if (!seen.has(g.id)) seen.set(g.id, g.title);
    } catch (e) {
      out.sources[label] = { url, ok: false, error: e.message };
    }
  };

  const cat = COMING_SOON_CATEGORIES[0];
  await Promise.all([
    // La fuente real que usa el scraper (en-us):
    probe("ENUS_categoria_coming_soon", `${COMING_SOON_BASE}/category/${cat}/1`, true),
    probe("ENUS_pagina_coming_soon", `${COMING_SOON_BASE}/pages/coming-soon`, true),
    // Comparación con es-cr (que dio 0), para confirmar el diagnóstico:
    probe("ESCR_categoria_coming_soon", `${PSN_BASE}/category/${cat}/1`, true),
    probe("ESCR_busqueda_preventa", `${PSN_BASE}/search/${encodeURIComponent("preventa")}`, false),
  ]);

  out.totalUnicos = seen.size;
  out.titulos = Array.from(seen.values()).slice(0, 60);
  return out;
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

// ─── IGDB: enriquecimiento de portadas ────────────────────────────────────────
//
// Para juegos que PSN devolvió sin imageUrl (frecuente en preventas), consulta
// IGDB (base de datos de juegos de Twitch/Amazon) para obtener la carátula.
// Se priorizan los juegos comingSoon porque PSN rara vez tiene imagen de esos.
// Máx 25 por scrape para no tocar el timeout de 30s de Vercel.

async function getIgdbToken() {
  const now = Date.now();
  if (_igdbToken && _igdbToken.exp > now + 60_000) return _igdbToken.tok;
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(IGDB_CLIENT_ID)}&client_secret=${encodeURIComponent(IGDB_CLIENT_SECRET)}&grant_type=client_credentials`,
    { method: "POST", signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) throw new Error(`IGDB token HTTP ${r.status}`);
  const d = await r.json();
  _igdbToken = { tok: d.access_token, exp: now + d.expires_in * 1000 };
  return d.access_token;
}

async function igdbCoverForTitle(title) {
  const tok = await getIgdbToken();
  const safe = title.replace(/\\/g, "").replace(/"/g, " ").trim();
  const r = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": IGDB_CLIENT_ID,
      "Authorization": `Bearer ${tok}`,
      "Content-Type": "text/plain",
    },
    body: `search "${safe}"; fields cover.image_id; limit 1;`,
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return "";
  const games = await r.json();
  const imageId = games?.[0]?.cover?.image_id;
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg` : "";
}

async function enrichWithIgdb(games, stats) {
  const MAX = 25;
  // Prioritize comingSoon (pre-orders) and then any game without cover
  const pool = games
    .filter(g => !g.imageUrl)
    .sort((a, b) => (b.comingSoon ? 1 : 0) - (a.comingSoon ? 1 : 0))
    .slice(0, MAX);
  if (!pool.length) return;

  // Process in parallel batches of 5 to stay well within rate limits
  const CONCURRENCY = 5;
  for (let i = 0; i < pool.length; i += CONCURRENCY) {
    await Promise.allSettled(
      pool.slice(i, i + CONCURRENCY).map(async g => {
        try {
          const cover = await igdbCoverForTitle(g.title);
          if (cover) { g.imageUrl = cover; stats.igdbEnriched++; }
        } catch { /* skip individual failures silently */ }
      })
    );
  }
}
