// Sincroniza el catálogo COMPLETO de Xbox (mercado Turquía) con múltiples
// fuentes y guarda los resultados en xbox-catalog.json via GitHub API.
// Corre desde GitHub Actions sin el timeout de 30s de Vercel.
//
// Fuentes (en orden de ejecución):
//   1. SIGLs del catálogo de Game Pass / Xbox TR (IDs directos)
//   2. Listas computadas de Microsoft Store (reco-public): top pagos/gratis,
//      mejor valorados, nuevos, ofertas, próximos — catálogo comprable amplio.
// La generación de consola (Xbox One / Series X|S) la deriva normalize() de los
// campos del propio producto (XboxConsoleGenCompatible/Optimized).
//
// Variables de entorno (las provee el runner de GitHub Actions):
//   GITHUB_TOKEN   — token con permisos de escritura sobre el repo
//   GITHUB_REPO    — "owner/repo" (ej: grafitico/rey-midas-digitales)
//   GITHUB_BRANCH  — rama donde commitear (ej: main)
//   RECO_COUNT     — items a pedir por lista computada (default 1000)

const MARKET = "TR";
const LANGUAGE = "tr-TR";
const TRY_USD_RATE = 0.028;

// SIGLs públicos del catálogo de Microsoft.
const SIGL_IDS = [
  "fdd9e2a7-0fee-49f6-ad69-4354098401ff", // Catálogo principal Xbox/Game Pass TR
];

// Etiquetas de generación de consola. NO dependemos de la fuente para esto:
// normalize() las deriva de los campos XboxConsoleGenCompatible/Optimized del
// propio producto (confirmado: taggea ~66% del catálogo correctamente).
const TAG_SERIES = "Xbox Series X|S";
const TAG_ONE = "Xbox One";

// Listas computadas de Microsoft Store (reco-public). Es la MISMA API que usa
// la app de Microsoft Store / xbox.com para sus carruseles. Devuelve IDs de
// producto (BigIds) por lista, sin auth. Reemplaza al browse de gamepass (daba
// 409) y al scraping de xbox.com (las páginas ya no traen __NEXT_DATA__).
// Agregando varias listas (top pagos, gratis, mejor valorados, nuevos, ofertas,
// próximos) cubrimos casi todo el catálogo comprable de Xbox, no solo Game Pass.
// Los nombres que no existan devuelven 404 y se descartan sin romper el sync.
const RECO_BASE = "https://reco-public.rec.mp.microsoft.com/channels/Reco/V8.0/Lists/Computed";
const RECO_LISTS = [
  "TopPaid",
  "TopFree",
  "BestRated",
  "NewReleases",
  "MostPlayed",
  "ComingSoon",
  "Deal",
  "TopGrossing",
  // Listas adicionales que amplían la cobertura más allá de los mismos ~430 IDs
  // que devolvían las 8 anteriores (se solapaban mucho entre sí).
  "BestSelling",
  "New",
  "MostShared",
  "TopBrowsed",
  "RecentlyUpdated",
];

// Familias de dispositivo a barrer con cada lista computada. La lista de Xbox
// sola se topaba en ~430 IDs únicos; sumando Windows.Desktop capturamos los
// juegos "Play Anywhere" (comprás una vez, jugás en consola Y PC) que la lista
// de consola no siempre incluye. normalize() igual descarta los PC-only que no
// sean Play Anywhere, así que no ensucia el catálogo con juegos que no corren
// en Xbox.
const DEVICE_FAMILIES = ["Windows.Xbox", "Windows.Desktop"];

const SIGL_BASE = "https://catalog.gamepass.com/sigls/v2";
const CATALOG_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products";
const BATCH_SIZE = 20;     // IDs por request al displaycatalog
const CONCURRENT = 5;      // Batches en paralelo
const RECO_COUNT = parseInt(process.env.RECO_COUNT || "1000", 10); // Items por lista
const OUTPUT_FILE = "xbox-catalog.json";
const GITHUB_API = "https://api.github.com";

const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/2.0)",
  "Accept": "application/json",
};

// ===== Entry point =====

async function main() {
  console.log("[sync-xbox] Iniciando sincronización multi-fuente del catálogo Xbox...");
  console.log(`[sync-xbox] RECO_COUNT=${RECO_COUNT} BATCH_SIZE=${BATCH_SIZE}`);

  const allIds = new Set();
  // platformTags queda como mecanismo opcional; las etiquetas de consola las
  // deriva normalize() de los datos del producto (no de la fuente).
  const platformTags = new Map();

  // ── Fase 1: SIGLs de Game Pass (catálogo Game Pass / Xbox) ────────────────
  for (const siglId of SIGL_IDS) {
    try {
      const ids = await withRetry(() => fetchSigl(siglId), `SIGL ${siglId}`);
      console.log(`[sync-xbox] SIGL ${siglId}: ${ids.length} IDs`);
      ids.forEach(id => allIds.add(id));
    } catch (e) {
      console.warn(`[sync-xbox] SIGL ${siglId} agotó reintentos: ${e.message}`);
    }
  }
  console.log(`[sync-xbox] Fase 1 — ${allIds.size} IDs únicos`);

  // ── Fase 2: Barrido de búsqueda (autosuggest de displaycatalog) ───────────
  //    La API reco-public (que traía "toda la tienda comprable") es inalcanzable
  //    desde los runners de GitHub (Azure) — falla con "fetch failed" y dejaba
  //    el catálogo clavado en ~430 juegos (solo Game Pass). En su lugar usamos
  //    el endpoint de búsqueda de displaycatalog.mp.microsoft.com (MISMO host
  //    que sí funciona en Fase 3): barremos por prefijos de título (aa..zz, 0-9)
  //    para enumerar buena parte del catálogo comprable de Xbox, muy por encima
  //    del tope de Game Pass.
  const beforeSweep = allIds.size;
  const seeds = buildSearchSeeds();
  console.log(`[sync-xbox] Fase 2 — barriendo ${seeds.length} búsquedas en autosuggest...`);
  let loggedShape = false;
  for (let i = 0; i < seeds.length; i += CONCURRENT) {
    const group = seeds.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(
      group.map(q => withRetry(() => fetchAutosuggest(q), `autosuggest "${q}"`, 2))
    );
    results.forEach(r => {
      if (r.status !== "fulfilled") return;
      // Log de la forma real de la primera respuesta con datos (para depurar).
      if (!loggedShape && r.value.raw) {
        loggedShape = true;
        console.log(`[sync-xbox] autosuggest shape: ${JSON.stringify(r.value.raw).slice(0, 400)}`);
      }
      r.value.ids.forEach(id => allIds.add(id));
    });
    const done = Math.min(i + CONCURRENT, seeds.length);
    if (done % 100 === 0 || done === seeds.length) {
      console.log(`[sync-xbox] autosuggest ${done}/${seeds.length} — acumulado ${allIds.size} IDs`);
    }
    await sleep(120);
  }
  console.log(`[sync-xbox] Fase 2 — autosuggest sumó +${allIds.size - beforeSweep} (total ${allIds.size} IDs únicos)`);

  // ── Fase 2b: Listas computadas reco-public (best-effort, 1 intento) ───────
  //    Si Microsoft vuelve a permitir reco desde el runner, esto vuelve a
  //    aportar; mientras siga caído, falla rápido (tries=1) sin frenar el sync.
  for (const list of RECO_LISTS) {
    try {
      const ids = await withRetry(() => fetchRecoList(list, "Windows.Xbox"), `reco ${list}`, 1);
      let added = 0;
      ids.forEach(id => { if (!allIds.has(id)) { allIds.add(id); added++; } });
      console.log(`[sync-xbox] reco ${list}: ${ids.length} IDs (+${added}) — acumulado ${allIds.size}`);
    } catch (e) {
      console.warn(`[sync-xbox] reco ${list} no disponible: ${e.message}`);
    }
  }
  console.log(`[sync-xbox] Fase 2 — ${allIds.size} IDs únicos`);

  const ids = [...allIds];
  if (!ids.length) {
    console.error("[sync-xbox] Sin IDs — abortando.");
    process.exit(1);
  }

  // ── Fase 3: Fetchear datos de productos en batches ────────────────────────
  const batches = chunk(ids, BATCH_SIZE);
  const allProducts = [];

  for (let i = 0; i < batches.length; i += CONCURRENT) {
    const group = batches.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(group.map(b => withRetry(() => fetchCatalogBatch(b), `batch ${i}`)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        allProducts.push(...r.value);
      } else {
        console.warn(`[sync-xbox] Batch ${i + j} error: ${r.reason?.message || r.reason}`);
      }
    });

    const done = Math.min(i + CONCURRENT, batches.length);
    if (done % 50 === 0 || done === batches.length) {
      console.log(`[sync-xbox] Progreso: ${done}/${batches.length} batches — ${allProducts.length} productos`);
    }
    if (i + CONCURRENT < batches.length) await sleep(300);
  }

  // ── Fase 4: Normalizar, deduplicar, ordenar ───────────────────────────────
  const seen = new Set();
  const games = allProducts
    .map(p => normalize(p, platformTags))
    .filter(g => {
      if (!g) return false;
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    })
    .sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return b.discount - a.discount;
    });

  console.log(`[sync-xbox] Total juegos únicos: ${games.length}`);

  if (games.length < 50) {
    console.error(`[sync-xbox] Solo ${games.length} juegos — probable bloqueo de Microsoft. Abortando sin commitear.`);
    process.exit(1);
  }

  const catalog = {
    updatedAt: new Date().toISOString(),
    count: games.length,
    games,
  };
  await commitCatalog(catalog);
  console.log(`[sync-xbox] ✓ Listo — ${games.length} juegos en ${OUTPUT_FILE}`);
}

// ===== Microsoft SIGL API =====

async function fetchSigl(siglId) {
  const url = `${SIGL_BASE}?id=${siglId}&language=${LANGUAGE}&market=${MARKET}`;
  const r = await fetch(url, { headers: API_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.map(x => (typeof x === "string" ? x : x.id)).filter(Boolean);
}

// ===== Microsoft Store reco-public (listas computadas) =====

// Trae los ProductIds (BigIds) de una lista computada de Microsoft Store para
// una familia de dispositivos dada. Devuelve un array de IDs en mayúsculas.
async function fetchRecoList(listName, deviceFamily = "Windows.Xbox") {
  const url = `${RECO_BASE}/${listName}` +
    `?Market=${MARKET}&Language=${LANGUAGE}&ItemTypes=Game` +
    `&Count=${RECO_COUNT}&DeviceFamily=${encodeURIComponent(deviceFamily)}`;
  const r = await fetch(url, { headers: API_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  // Shape esperada: { Items: [ { Id, Type }, ... ] }. Aceptamos variantes.
  const items = data.Items || data.items || data.Products || [];
  if (!Array.isArray(items)) return [];
  return items
    .map(i => (typeof i === "string" ? i : (i.Id || i.id || i.ProductId || i.bigId)))
    .filter(id => id && /^[A-Z0-9]{9,16}$/i.test(id))
    .map(id => id.toUpperCase());
}

// ===== Búsqueda / enumeración (autosuggest de displaycatalog) =====

// Semillas de búsqueda para enumerar el catálogo por prefijos de título.
// aa..zz (676) + a..z (26) + 0..9 (10). autosuggest hace match tipo typeahead,
// así que barrer prefijos cortos cubre casi cualquier inicio de título.
function buildSearchSeeds() {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const seeds = [];
  for (const a of letters) {
    seeds.push(a);
    for (const b of letters) seeds.push(a + b);
  }
  for (const d of "0123456789".split("")) seeds.push(d);
  return seeds;
}

// Extrae recursivamente cualquier BigId (12 alfanum. tipo 9NBLGGH4R315) de una
// respuesta JSON de forma desconocida. Robusto ante cambios de esquema: junta
// todo string que sea un BigId de la Store, venga en el campo que venga.
function extractBigIds(node, out) {
  if (node == null) return;
  if (typeof node === "string") {
    if (/^[A-Z0-9]{12}$/.test(node)) out.add(node.toUpperCase());
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) extractBigIds(v, out);
    return;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) extractBigIds(node[k], out);
  }
}

// Autosuggest de la Store: devuelve productos que matchean `query`. Lo usamos
// para enumerar el catálogo comprable barriendo prefijos. Devuelve { ids, raw }.
const AUTOSUGGEST_URL = "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest";
async function fetchAutosuggest(query) {
  const url = `${AUTOSUGGEST_URL}` +
    `?market=${MARKET}&languages=${LANGUAGE}` +
    `&productFamilyNames=Games` +
    `&query=${encodeURIComponent(query)}&topProducts=25`;
  const r = await fetch(url, { headers: { ...API_HEADERS, "MS-CV": "ReyMidas.3" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const ids = new Set();
  extractBigIds(data, ids);
  return { ids: [...ids], raw: ids.size ? data : null };
}

// ===== Microsoft Display Catalog API =====

async function fetchCatalogBatch(ids) {
  const url = `${CATALOG_URL}?bigIds=${ids.join(",")}&market=${MARKET}&languages=${LANGUAGE}&fieldsTemplate=Details`;
  const r = await fetch(url, {
    headers: {
      ...API_HEADERS,
      "MS-CV": "ReyMidas.2",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.Products || [];
}

// ===== Normalización =====

function normalize(p, platformTags) {
  const id = p.ProductId;
  if (!id) return null;

  const lp = (p.LocalizedProperties || [])[0] || {};
  const title = lp.ProductTitle || lp.ShortTitle;
  if (!title) return null;

  // Filtrar juegos PC-only (Game Pass for PC sin soporte en consola Xbox).
  const props = p.Properties || {};
  if (props.XboxTitle === false && props.IsXboxPlayAnywhere !== true) return null;

  // Generación de consola. Primario: las etiquetas que vienen de la fuente
  // (filtro PlayWith=XboxOne / XboxSeriesX|S de la propia Microsoft). Fallback:
  // los arrays de gen del producto (ConsoleGen8 = Xbox One, ConsoleGen9 = Series).
  const consoles = new Set(platformTags?.get(id.toUpperCase()) || []);
  const genArrays = [
    ...(props.XboxConsoleGenCompatible || []),
    ...(props.XboxConsoleGenOptimized || []),
  ].map(String);
  if (genArrays.some(g => /9/.test(g))) consoles.add("Xbox Series X|S");
  if (genArrays.some(g => /[78]/.test(g))) consoles.add("Xbox One");

  // Imagen: Poster > BoxArt > SuperHeroArt > Tile > primera disponible
  let imageUrl = "";
  const images = lp.Images || [];
  const poster =
    images.find(i => i.ImagePurpose === "Poster") ||
    images.find(i => i.ImagePurpose === "BoxArt") ||
    images.find(i => i.ImagePurpose === "SuperHeroArt") ||
    images.find(i => i.ImagePurpose === "Tile") ||
    images[0];
  if (poster) imageUrl = poster.Uri.startsWith("//") ? `https:${poster.Uri}` : poster.Uri;

  // Precio: menor ListPrice > 0 de SKU "full" con acción "Purchase"
  const candidates = [];
  for (const sku of (p.DisplaySkuAvailabilities || [])) {
    if (sku.Sku?.SkuType && sku.Sku.SkuType !== "full") continue;
    for (const av of (sku.Availabilities || [])) {
      if (!(av.Actions || []).includes("Purchase")) continue;
      const price = av.OrderManagementData?.Price;
      if (!price) continue;
      const list = Number(price.ListPrice);
      if (!list || list <= 0) continue;
      const isTRY = (price.CurrencyCode || "").toUpperCase() === "TRY";
      const toUSD = amt => isTRY ? Math.round(amt * TRY_USD_RATE * 100) / 100 : amt;
      candidates.push({ list: toUSD(list), msrp: toUSD(Number(price.MSRP) || list) });
    }
  }
  if (!candidates.length) return null;

  const best = candidates.reduce((a, b) => (a.list < b.list ? a : b));
  const listPrice = best.list;
  const original = best.msrp;
  const onSale = original > listPrice;

  return {
    id: `xbox-${id}`,
    title,
    platform: "Xbox",
    imageUrl,
    url: `https://www.xbox.com/games/store/_/${id}`,
    priceUSD: listPrice,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - listPrice / original) * 100) : 0,
    // Generaciones soportadas, ordenadas: Series primero. [] = desconocido.
    consoles: ["Xbox Series X|S", "Xbox One"].filter(c => consoles.has(c)),
    isBundle: /bundle|edition|collection|pack|deluxe|ultimate|gold|premium|definitive|remaster/i.test(title),
  };
}

// ===== Reintentos con backoff =====

async function withRetry(fn, label, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = 1000 * Math.pow(2, i);
      console.warn(`[sync-xbox] ${label} intento ${i + 1}/${tries} falló: ${e.message} — espero ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ===== GitHub commit =====

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en el entorno");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rey-midas-xbox-sync",
  };
}

async function commitCatalog(catalog) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!repo) throw new Error("Falta GITHUB_REPO en el entorno");

  const content = JSON.stringify(catalog, null, 2);
  const encoded = Buffer.from(content, "utf8").toString("base64");

  const getUrl = `${GITHUB_API}/repos/${repo}/contents/${OUTPUT_FILE}?ref=${encodeURIComponent(branch)}`;
  const getRes = await fetch(getUrl, { headers: ghHeaders() });
  let sha;
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status === 404) {
    sha = undefined;
  } else {
    throw new Error(`GitHub GET ${getRes.status}: ${await getRes.text()}`);
  }

  const putUrl = `${GITHUB_API}/repos/${repo}/contents/${OUTPUT_FILE}`;
  const body = {
    message: `chore: sync Xbox catalog — ${catalog.count} juegos [${new Date().toISOString().slice(0, 10)}]`,
    content: encoded,
    branch,
    ...(sha ? { sha } : {}),
  };
  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    throw new Error(`GitHub PUT ${putRes.status}: ${(await putRes.text()).slice(0, 300)}`);
  }
  const result = await putRes.json();
  console.log(`[sync-xbox] Commit: ${result.commit?.sha?.slice(0, 7)} en ${repo}@${branch}`);
}

// ===== Utilidades =====

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== Run =====
main().catch(e => {
  console.error("[sync-xbox] Error fatal:", e);
  process.exit(1);
});
