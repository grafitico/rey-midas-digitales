// Sincroniza el catálogo completo de Xbox (mercado Turquía) con las APIs
// públicas de Microsoft y guarda los resultados en xbox-catalog.json via
// GitHub API. Corre desde GitHub Actions sin el timeout de 30s de Vercel,
// por lo que puede procesar TODOS los IDs del SIGL (vs. los 80 del endpoint).
//
// Variables de entorno requeridas (las provee el runner de GitHub Actions):
//   GITHUB_TOKEN   — token con permisos de escritura sobre el repo
//   GITHUB_REPO    — "owner/repo" (ej: grafitico/rey-midas-digitales)
//   GITHUB_BRANCH  — rama donde commitear (ej: main)
//   MAX_GAMES      — cap final de juegos (default 600)

const MARKET = "TR";
const LANGUAGE = "tr-TR";
const TRY_USD_RATE = 0.028;

// SIGLs públicos del catálogo de Microsoft.
// Agregar más UUIDs aquí para ampliar cobertura — se deduplicarán por ProductId.
const SIGL_IDS = [
  "fdd9e2a7-0fee-49f6-ad69-4354098401ff",  // Catálogo principal Xbox/Game Pass TR
];

const SIGL_BASE = "https://catalog.gamepass.com/sigls/v2";
const CATALOG_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products";
const BATCH_SIZE = 20;   // IDs por request al displaycatalog
const CONCURRENT = 5;    // Batches en paralelo (sin saturar la API de Microsoft)
const MAX_GAMES = parseInt(process.env.MAX_GAMES || "600", 10);
const OUTPUT_FILE = "xbox-catalog.json";
const GITHUB_API = "https://api.github.com";

// ===== Entry point =====

async function main() {
  console.log("[sync-xbox] Iniciando sincronización de catálogo Xbox...");
  console.log(`[sync-xbox] Cap de juegos: ${MAX_GAMES}`);

  // 1. Obtener todos los IDs de todos los SIGLs configurados
  const allIds = new Set();
  for (const siglId of SIGL_IDS) {
    try {
      const ids = await fetchSigl(siglId);
      console.log(`[sync-xbox] SIGL ${siglId}: ${ids.length} IDs`);
      ids.forEach(id => allIds.add(id));
    } catch (e) {
      console.warn(`[sync-xbox] SIGL ${siglId} falló: ${e.message}`);
    }
  }

  const ids = [...allIds];
  console.log(`[sync-xbox] Total IDs únicos: ${ids.length}`);
  if (!ids.length) {
    console.error("[sync-xbox] Sin IDs — abortando.");
    process.exit(1);
  }

  // 2. Fetchear datos de productos en batches con concurrencia controlada
  const batches = chunk(ids, BATCH_SIZE);
  const allProducts = [];

  for (let i = 0; i < batches.length; i += CONCURRENT) {
    const group = batches.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(group.map(fetchCatalogBatch));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        allProducts.push(...r.value);
      } else {
        console.warn(`[sync-xbox] Batch ${i + j} error: ${r.reason?.message || r.reason}`);
      }
    });

    const done = Math.min(i + CONCURRENT, batches.length);
    console.log(`[sync-xbox] Progreso: ${done}/${batches.length} batches — ${allProducts.length} productos acumulados`);

    // Pausa entre grupos para no saturar la API de Microsoft
    if (i + CONCURRENT < batches.length) {
      await sleep(300);
    }
  }

  // 3. Normalizar, deduplicar por ProductId y ordenar
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
      // Primero los que están en oferta, luego por mayor descuento
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return b.discount - a.discount;
    })
    .slice(0, MAX_GAMES);

  console.log(`[sync-xbox] Juegos normalizados y únicos: ${games.length}`);

  // 4. Commitear a GitHub
  const catalog = {
    updatedAt: new Date().toISOString(),
    count: games.length,
    games,
  };
  await commitCatalog(catalog);
  console.log(`[sync-xbox] ✓ Listo — ${games.length} juegos en ${OUTPUT_FILE}`);
}

// ===== Microsoft APIs =====

async function fetchSigl(siglId) {
  const url = `${SIGL_BASE}?id=${siglId}&language=${LANGUAGE}&market=${MARKET}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
      "Accept": "application/json",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.map(x => (typeof x === "string" ? x : x.id)).filter(Boolean);
}

async function fetchCatalogBatch(ids) {
  const url = `${CATALOG_URL}?bigIds=${ids.join(",")}&market=${MARKET}&languages=${LANGUAGE}&fieldsTemplate=Details`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
      "Accept": "application/json",
      "MS-CV": "ReyMidas.1",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.Products || [];
}

// ===== Normalización (mismo criterio que /api/scrape-xbox.js) =====

function normalize(p) {
  const id = p.ProductId;
  if (!id) return null;

  const lp = (p.LocalizedProperties || [])[0] || {};
  const title = lp.ProductTitle || lp.ShortTitle;
  if (!title) return null;

  // Filtrar juegos PC-only (Game Pass for PC sin soporte en consola Xbox).
  // El SIGL mezcla títulos de Xbox Console y de PC; XboxTitle===false indica
  // que el producto es exclusivo de Windows y no sirve para la tienda.
  // IsXboxPlayAnywhere===true lo rescata porque corre en ambas plataformas.
  // Si XboxTitle está ausente (undefined) conservamos el juego para no
  // descartar títulos válidos cuando la API no devuelve el campo.
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
  // Los juegos solo de Game Pass tienen ListPrice=0 o sin acción "Purchase"
  // y se descartan — solo mostramos juegos con precio de venta individual.
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

  // Obtener SHA actual (necesario para actualizar un archivo existente)
  const getUrl = `${GITHUB_API}/repos/${repo}/contents/${OUTPUT_FILE}?ref=${encodeURIComponent(branch)}`;
  const getRes = await fetch(getUrl, { headers: ghHeaders() });
  let sha;
  if (getRes.ok) {
    const meta = await getRes.json();
    sha = meta.sha;
  } else if (getRes.status === 404) {
    sha = undefined; // Archivo nuevo, no requiere SHA
  } else {
    throw new Error(`GitHub GET ${getRes.status}: ${await getRes.text()}`);
  }

  // Commitear el archivo actualizado
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
    const text = await putRes.text();
    throw new Error(`GitHub PUT ${putRes.status}: ${text.slice(0, 300)}`);
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
