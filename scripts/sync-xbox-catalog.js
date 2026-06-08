// Sincroniza el catálogo COMPLETO de Xbox (mercado Turquía) con múltiples
// fuentes y guarda los resultados en xbox-catalog.json via GitHub API.
// Corre desde GitHub Actions sin el timeout de 30s de Vercel.
//
// Fuentes (en orden de ejecución):
//   1. SIGLs del catálogo de Game Pass / Xbox TR
//   2. catalog.gamepass.com/browse — paginado por plataforma (XboxSeriesX|S + XboxOne)
//   3. Páginas HTML del Xbox Store turco con __NEXT_DATA__ (deals, all-games por plataforma)
//
// Variables de entorno (las provee el runner de GitHub Actions):
//   GITHUB_TOKEN   — token con permisos de escritura sobre el repo
//   GITHUB_REPO    — "owner/repo" (ej: grafitico/rey-midas-digitales)
//   GITHUB_BRANCH  — rama donde commitear (ej: main)
//   BROWSE_PAGES   — páginas de browse por plataforma (default 80)

const MARKET = "TR";
const LANGUAGE = "tr-TR";
const TRY_USD_RATE = 0.028;

// SIGLs públicos del catálogo de Microsoft.
const SIGL_IDS = [
  "fdd9e2a7-0fee-49f6-ad69-4354098401ff", // Catálogo principal Xbox/Game Pass TR
];

// Páginas HTML del Xbox Store turco. El scraper extrae ProductIds embebidos
// en __NEXT_DATA__ (Next.js SSR). Captura juegos de deals y por plataforma.
const XBOX_HTML_PAGES = [
  "https://www.xbox.com/tr-TR/games/browse/DynamicChannel.GameDeals",
  "https://www.xbox.com/tr-TR/games/all-games/console?PlayWith=XboxSeriesX%7CS&TechnicalFeatures=ConsoleGen9Optimized",
  "https://www.xbox.com/tr-TR/games/all-games/console?PlayWith=XboxOne",
  "https://www.xbox.com/tr-TR/games/all-games/console?PlayWith=XboxSeriesX%7CS",
  "https://www.xbox.com/tr-TR/games/browse/new",
  "https://www.xbox.com/tr-TR/games/browse/coming-soon",
];

// Plataformas a usar en catalog.gamepass.com/browse.
// El pipe (|) se codifica como %7C en la URL.
const BROWSE_PLATFORMS = ["XboxSeriesX%7CS", "XboxOne"];

const SIGL_BASE = "https://catalog.gamepass.com/sigls/v2";
const BROWSE_BASE = "https://catalog.gamepass.com/browse";
const CATALOG_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products";
const BATCH_SIZE = 20;    // IDs por request al displaycatalog
const CONCURRENT = 5;     // Batches en paralelo
const BROWSE_COUNT = 100; // Items por página de browse
const BROWSE_MAX_PAGES = parseInt(process.env.BROWSE_PAGES || "80", 10);
const OUTPUT_FILE = "xbox-catalog.json";
const GITHUB_API = "https://api.github.com";

// Headers de navegador para páginas HTML (evita bloqueos por bot-detection)
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
};

const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/2.0)",
  "Accept": "application/json",
};

// ===== Entry point =====

async function main() {
  console.log("[sync-xbox] Iniciando sincronización multi-fuente del catálogo Xbox...");
  console.log(`[sync-xbox] BROWSE_PAGES=${BROWSE_MAX_PAGES} BATCH_SIZE=${BATCH_SIZE}`);

  const allIds = new Set();

  // ── Fase 1: SIGLs de Game Pass (fuente original, fiable) ──────────────────
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

  // ── Fase 2: catalog.gamepass.com/browse paginado por plataforma ───────────
  for (const platform of BROWSE_PLATFORMS) {
    const ids = await browseCatalogByPlatform(platform);
    console.log(`[sync-xbox] Browse ${decodeURIComponent(platform)}: ${ids.length} IDs`);
    ids.forEach(id => allIds.add(id));
  }
  console.log(`[sync-xbox] Fase 2 — ${allIds.size} IDs únicos`);

  // ── Fase 3: Páginas HTML del Xbox Store turco ─────────────────────────────
  for (const url of XBOX_HTML_PAGES) {
    const ids = await extractIdsFromPage(url);
    const label = url.split("?")[0].split("/").slice(-2).join("/");
    console.log(`[sync-xbox] HTML ${label}: ${ids.length} IDs`);
    ids.forEach(id => allIds.add(id));
    await sleep(400);
  }
  console.log(`[sync-xbox] Fase 3 — ${allIds.size} IDs únicos`);

  const ids = [...allIds];
  if (!ids.length) {
    console.error("[sync-xbox] Sin IDs — abortando.");
    process.exit(1);
  }

  // ── Fase 4: Fetchear datos de productos en batches ────────────────────────
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

  // ── Fase 5: Normalizar, deduplicar, ordenar ───────────────────────────────
  const seen = new Set();
  const games = allProducts
    .map(normalize)
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

// ===== catalog.gamepass.com/browse =====

async function browseCatalogByPlatform(platformEncoded) {
  const ids = [];
  for (let page = 0; page < BROWSE_MAX_PAGES; page++) {
    const skipItems = page * BROWSE_COUNT;
    const url = `${BROWSE_BASE}?market=${MARKET}&language=${LANGUAGE}&platformFilters=${platformEncoded}&mediaType=game&count=${BROWSE_COUNT}&skipItems=${skipItems}`;

    try {
      const r = await fetch(url, { headers: API_HEADERS });
      if (!r.ok) {
        if (r.status === 404 || r.status === 400) break; // Endpoint no existe para este parámetro
        console.warn(`[sync-xbox] browse ${decodeURIComponent(platformEncoded)} p${page}: HTTP ${r.status}`);
        break;
      }
      const data = await r.json();

      // catalog.gamepass.com/browse puede devolver distintas shapes
      const items = data.results || data.Products || data.items || data.ids || [];
      if (!Array.isArray(items) || !items.length) break;

      const pageIds = items
        .map(i => (typeof i === "string" ? i : (i.id || i.ProductId || i.bigId || i.BigId)))
        .filter(id => id && /^[A-Z0-9]{9,16}$/i.test(id));

      ids.push(...pageIds);
      if (pageIds.length < BROWSE_COUNT) break; // Última página
      await sleep(250);
    } catch (e) {
      console.warn(`[sync-xbox] browse ${decodeURIComponent(platformEncoded)} p${page}: ${e.message}`);
      break;
    }
  }
  return ids;
}

// ===== HTML scraping (Xbox Store __NEXT_DATA__) =====

async function extractIdsFromPage(url) {
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS });
    if (!r.ok) return [];
    const html = await r.text();

    // Xbox Store (Next.js SSR) embebe los datos en __NEXT_DATA__
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];

    const data = JSON.parse(m[1]);
    const ids = [];
    collectProductIds(data, ids, 0);
    return [...new Set(ids)];
  } catch (e) {
    console.warn(`[sync-xbox] extractIdsFromPage ${url.split("?")[0]}: ${e.message}`);
    return [];
  }
}

// Busca recursivamente campos ProductId / productId / BigId / bigId en el JSON.
// Los ProductIds de Xbox son strings de 9-16 caracteres alfanuméricos mayúsculas.
function collectProductIds(obj, ids, depth) {
  if (depth > 14 || !obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectProductIds(item, ids, depth + 1);
    return;
  }
  for (const [key, val] of Object.entries(obj)) {
    if ((key === "ProductId" || key === "productId" || key === "BigId" || key === "bigId") &&
        typeof val === "string" && /^[A-Z0-9]{9,16}$/i.test(val)) {
      ids.push(val.toUpperCase());
    } else if (val && typeof val === "object") {
      collectProductIds(val, ids, depth + 1);
    }
  }
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

function normalize(p) {
  const id = p.ProductId;
  if (!id) return null;

  const lp = (p.LocalizedProperties || [])[0] || {};
  const title = lp.ProductTitle || lp.ShortTitle;
  if (!title) return null;

  // Filtrar juegos PC-only (Game Pass for PC sin soporte en consola Xbox).
  const props = p.Properties || {};
  if (props.XboxTitle === false && props.IsXboxPlayAnywhere !== true) return null;

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
