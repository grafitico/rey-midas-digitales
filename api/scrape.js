// Scraper de PlayStation Store (es-cr) — v4.
//
// Cambia el modelo de fuentes respecto a v3:
//
// - Antes traíamos ~3600 juegos de UNA sola categoría genérica
//   (44d8bb20…), ordenada por release date desc por PSN. El resultado
//   era 3000+ indies/F2P/demos recientes y casi cero AAA visibles en
//   las primeras páginas.
//
// - Ahora la fuente primaria son las categorías de género (Action,
//   Shooter, Sports, RPG…). Estas concentran AAA por su naturaleza:
//   Action tiene GTA, COD, Spider-Man, God of War; Sports tiene FIFA,
//   NBA2K; Racing tiene Gran Turismo, NFS, Forza; etc.
//
// - La categoría genérica se mantiene como secundaria con cap chico
//   (30 páginas) solo para completar lo que las de género no traen.
//
// - Marcamos `isAAA` por título contra una regex de franquicias
//   conocidas. Después filtramos indies (precio < $5 y no AAA, o
//   demos/trials no AAA) y ordenamos AAA primero.
//
// - Si llamás con ?debug=1, devolvemos muestras por fuente para ver
//   exactamente qué trajo cada query y dónde está fallando.

const PSN_BASE = "https://store.playstation.com/es-cr";

// Fuente primaria: categorías de género. Cada una concentra AAA del
// género y sus tags se cuelgan a cada juego que aparece adentro.
const GENRE_CATEGORIES = [
  { tag: "accion",     uuid: "298b428c-0c39-4ec8-abd5-237484e5a2ea", maxPages: 40 },
  { tag: "shooter",    uuid: "64ee024b-7644-468a-92c6-370269075d5c", maxPages: 30 },
  { tag: "rpg",        uuid: "e0b1cde3-a7ea-4d7a-960a-fa5edbafae8f", maxPages: 30 },
  { tag: "deportes",   uuid: "b86f0f65-cf49-4f96-8cdd-3991ca17eadc", maxPages: 25 },
  { tag: "carreras",   uuid: "f45ce6b0-61ef-4b78-94c3-048d81b07f98", maxPages: 20 },
  { tag: "lucha",      uuid: "02e50754-377f-4546-9252-67cfebb2e5b0", maxPages: 15 },
  { tag: "terror",     uuid: "6ec578f6-d6b7-423c-8b93-14e14a5a43f2", maxPages: 15 },
  { tag: "simulacion", uuid: "bb42a4e0-2d0e-40e5-9714-ae4e10320f24", maxPages: 15 },
  { tag: "infantiles", uuid: "9d30a9d8-1a3c-462d-865d-0be3f208e6d2", maxPages: 15 },
];

// Categoría genérica — fallback, cap bajo. Sirve para sumar juegos
// que no caen en ningún género específico.
const FALLBACK_CATEGORY = {
  uuid: "44d8bb20-653e-431e-8ad0-c0a365f68d2f",
  maxPages: 30,
};

// Búsquedas de género adicionales (tags sin categoría dedicada).
const GENRE_SEARCHES = [
  { tag: "aventura",   query: "aventura" },
  { tag: "estrategia", query: "estrategia" },
];

// Búsquedas semilla — fuerzan que franquicias AAA específicas estén
// en el catálogo aunque queden enterradas en otras fuentes.
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
  "cyberpunk", "hogwarts", "red dead", "fallout",
  "skyrim", "mass effect", "halo", "forza",
  "starfield", "overwatch", "destiny", "final fantasy",
  "kingdom hearts", "persona", "monster hunter", "nier",
  "sonic", "witcher", "hitman", "dying light",
  "bioshock", "wolfenstein", "doom", "rainbow six",
  "the division", "saints row", "mafia", "burnout",
  "tony hawk", "ace combat", "fortnite", "apex",
  "silent hill", "dead space", "until dawn",
  "ghost of tsushima", "sekiro", "bloodborne", "nioh",
  "civilization", "alan wake", "returnal", "yakuza",
  "tales of", "bayonetta", "devil may cry", "ninja gaiden",
  "hellblade", "max payne", "stray", "it takes two",
  "hades", "hollow knight",
];

// Franquicias AAA por título — usado para marcar isAAA y para
// proteger del filtro anti-indie. Misma lista que app.js para que
// front y back coincidan.
const AAA_FRANCHISE_REGEX = /\b(crash bandicoot|need for speed|fifa|ea sports fc|gta|grand theft auto|call of duty|assassin'?s creed|tomb raider|spider-?man|uncharted|god of war|resident evil|battlefield|minecraft|rocket league|mortal kombat|tekken|street fighter|the last of us|metal gear|dark souls|elden ring|horizon|nba 2k|madden|wwe ?2k|f1 [0-9]|watch dogs|far cry|borderlands|dragon ball|naruto|one piece|lego|ratchet|gran turismo|diablo|cyberpunk|hogwarts|red dead|fallout|skyrim|mass effect|halo|forza|gears of war|sea of thieves|starfield|overwatch|destiny|final fantasy|kingdom hearts|persona|monster hunter|nier|sonic|the witcher|hitman|dying light|metro exodus|bioshock|wolfenstein|doom eternal|rainbow six|the division|saints row|mafia|burnout|dirt [0-9]|mlb the show|tony hawk|ufc [0-9]|ace combat|the crew|forza horizon|forza motorsport|fortnite|apex legends|fall guys|silent hill|dead space|alien isolation|until dawn|the evil within|days gone|ghost of tsushima|sekiro|bloodborne|nioh|civilization|total war|portal [0-9]|left 4 dead|alan wake|returnal|deathloop|like a dragon|yakuza|judgment|tales of|bayonetta|devil may cry|ninja gaiden|hellblade|fable|max payne|hogwarts legacy|stray|it takes two|hades|hollow knight)\b/i;

// Patrones de basura — drop si matchea Y no es AAA.
const JUNK_TITLE_REGEX = /\b(demo|trial|beta|prologue|teaser|test|preview|early access|free version|free trial|temporary entitlement|avatar|theme|wallpaper|soundtrack|ost|in-game currency|pack de monedas|paquete de monedas|moneda virtual|virtual currency|v-?bucks|cr coins|fc points|fifa points)\b/i;

// Precio piso para no-AAA. Indies de menos de $5 son ruido para el catálogo.
const MIN_PRICE_NON_AAA = 5;

const PAGE_CHUNK = 10;
const FALLBACK_PAGE_CHUNK = 15;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const debug = req.query?.debug === "1";
  // En debug bypass total de cache (Vercel edge + browser) para que
  // siempre se vea data fresca al diagnosticar.
  if (debug) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  } else {
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  }

  try {
    const map = new Map();
    const genreMap = new Map(); // gameId -> Set<genreTag>
    const sourceCounts = {}; // sourceName -> { fetched, items, samples: [...] }
    const stats = {
      sourcesScanned: 0,
      pagesFetched: 0,
      pagesEmpty: 0,
      pagesFailed: 0,
    };

    function trackSource(name) {
      if (!sourceCounts[name]) sourceCounts[name] = { items: 0, samples: [] };
      return sourceCounts[name];
    }

    function addGames(games, sourceName, tag) {
      const src = trackSource(sourceName);
      for (const g of games) {
        if (!map.has(g.id)) map.set(g.id, g);
        src.items++;
        if (src.samples.length < 3) src.samples.push(g.title);
        if (tag) {
          if (!genreMap.has(g.id)) genreMap.set(g.id, new Set());
          genreMap.get(g.id).add(tag);
        }
      }
    }

    // Categorías de género (fuente primaria).
    const genreWork = GENRE_CATEGORIES.map(async ({ tag, uuid, maxPages }) => {
      const sourceName = `genre:${tag}`;
      stats.sourcesScanned++;
      try {
        const items = await fetchCategoryPaginated(uuid, stats, maxPages, PAGE_CHUNK);
        addGames(items, sourceName, tag);
      } catch (e) {
        trackSource(sourceName).error = e.message;
      }
    });

    // Categoría genérica (fallback secundario).
    const fallbackWork = (async () => {
      const sourceName = `fallback:catalog`;
      stats.sourcesScanned++;
      try {
        const items = await fetchCategoryPaginated(
          FALLBACK_CATEGORY.uuid, stats, FALLBACK_CATEGORY.maxPages, FALLBACK_PAGE_CHUNK
        );
        addGames(items, sourceName, null);
      } catch (e) {
        trackSource(sourceName).error = e.message;
      }
    })();

    // Búsquedas de género adicionales.
    const genreSearchWork = GENRE_SEARCHES.map(async ({ tag, query }) => {
      const sourceName = `genre-search:${tag}`;
      stats.sourcesScanned++;
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`);
        addGames(games, sourceName, tag);
      } catch (e) {
        trackSource(sourceName).error = e.message;
      }
    });

    // Seed searches — franquicias AAA explícitas.
    const seedWork = SEED_SEARCHES.map(async (query) => {
      const sourceName = `seed:${query}`;
      stats.sourcesScanned++;
      try {
        const games = await fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`);
        addGames(games, sourceName, null);
      } catch (e) {
        trackSource(sourceName).error = e.message;
      }
    });

    await Promise.all([
      ...genreWork,
      fallbackWork,
      ...genreSearchWork,
      ...seedWork,
    ]);

    // Post-procesamiento: tag AAA + filtro anti-indie.
    const beforeFilter = map.size;
    let droppedJunk = 0;
    let droppedCheap = 0;
    let keptAAA = 0;

    const games = [];
    for (const g of map.values()) {
      const isAAA = AAA_FRANCHISE_REGEX.test(g.title);
      g.isAAA = isAAA;
      g.genres = Array.from(genreMap.get(g.id) || []);

      if (!isAAA && JUNK_TITLE_REGEX.test(g.title)) { droppedJunk++; continue; }
      if (!isAAA && g.originalPriceUSD < MIN_PRICE_NON_AAA) { droppedCheap++; continue; }
      if (isAAA) keptAAA++;
      games.push(g);
    }

    // Orden: AAA primero, después por precio original descendente (los
    // AAA suelen ser $40-70, los premium quedan arriba), después por
    // descuento descendente.
    games.sort((a, b) => {
      if (a.isAAA !== b.isAAA) return a.isAAA ? -1 : 1;
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      if (b.originalPriceUSD !== a.originalPriceUSD) return b.originalPriceUSD - a.originalPriceUSD;
      return b.discount - a.discount;
    });

    stats.gamesBeforeFilter = beforeFilter;
    stats.gamesAfterFilter = games.length;
    stats.droppedJunk = droppedJunk;
    stats.droppedCheap = droppedCheap;
    stats.gamesAAA = keptAAA;
    stats.gamesTagged = games.filter(g => g.genres.length > 0).length;

    if (debug) {
      const sourcesSummary = {};
      for (const [name, info] of Object.entries(sourceCounts)) {
        sourcesSummary[name] = {
          items: info.items,
          samples: info.samples,
          ...(info.error ? { error: info.error } : {}),
        };
      }
      const aaaSample = games.filter(g => g.isAAA).slice(0, 30).map(g => g.title);
      return res.status(200).json({
        success: true,
        count: games.length,
        stats,
        sources: sourcesSummary,
        aaaSample,
        firstPageSample: games.slice(0, 20).map(g => ({
          title: g.title, priceUSD: g.priceUSD, originalPriceUSD: g.originalPriceUSD,
          isAAA: g.isAAA, genres: g.genres, onSale: g.onSale,
        })),
      });
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

async function fetchCategoryPaginated(catId, stats, maxPages, chunkSize) {
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
          chunkProduced = true;
        } else {
          stats.pagesEmpty++;
        }
      } else {
        stats.pagesFailed++;
      }
    }
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

  const out = [];
  const seen = new Set();

  function consider(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    const looksLikeProduct =
      obj.__typename === "Product" ||
      (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id) && typeof obj.name === "string");
    if (looksLikeProduct) {
      const g = normalize(obj);
      if (g && !seen.has(g.id)) {
        seen.add(g.id);
        out.push(g);
      }
    }
  }

  // Camino rápido: apolloState (categorías paginadas usan esto).
  const cache = data?.props?.apolloState;
  if (cache && typeof cache === "object") {
    for (const key of Object.keys(cache)) consider(cache[key]);
  }

  // Fallback: recorrer todo el __NEXT_DATA__ buscando Products en
  // cualquier path. Las páginas de /search/ y algunas categorías
  // nuevas no exponen apolloState al nivel raíz — los productos
  // viven más adentro en props.pageProps o en GraphQL caches con
  // claves distintas. Esto los pesca igual.
  const stack = [data?.props];
  let visited = 0;
  while (stack.length && visited < 200000) {
    const node = stack.pop();
    visited++;
    if (!node || typeof node !== "object") continue;
    consider(node);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
    } else {
      for (const k of Object.keys(node)) stack.push(node[k]);
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
  };
}

function parsePrice(str) {
  if (str == null) return 0;
  if (typeof str === "number") return str;
  const m = String(str).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
