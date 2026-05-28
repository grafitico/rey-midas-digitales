// Scraper de Xbox usando APIs públicas de Microsoft.
// 1. catalog.gamepass.com/sigls/v2 → lista de IDs de juegos
// 2. displaycatalog.mp.microsoft.com/v7.0/products → datos completos por ID
// Tanto los SIGL como displaycatalog son endpoints públicos sin auth.

const SIGL_URL =
  "https://catalog.gamepass.com/sigls/v2?id=fdd9e2a7-0fee-49f6-ad69-4354098401ff&language=en-US&market=US";
const CATALOG_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products";
const BATCH_SIZE = 20;
const MAX_GAMES = 80;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const ids = await fetchSigl();
    if (!ids.length) {
      return res.status(200).json({
        success: true, count: 0, games: [],
        error: "SIGL devolvió 0 IDs",
      });
    }

    const sample = ids.slice(0, MAX_GAMES);
    const batches = chunk(sample, BATCH_SIZE);
    const results = await Promise.allSettled(batches.map(fetchCatalogBatch));

    const all = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") all.push(...r.value);
      else errors.push({ batch: i, error: r.reason?.message || String(r.reason) });
    });

    // Modo debug: devolver el primer producto crudo para inspeccionar estructura
    if (req.query.debug === "1") {
      return res.status(200).json({
        success: true,
        idsFetched: sample.length,
        productsReturned: all.length,
        firstProduct: all[0] || null,
        errors: errors.length ? errors : undefined,
      });
    }

    const games = all.map(normalize).filter(Boolean).sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return b.discount - a.discount;
    });

    return res.status(200).json({
      success: true,
      count: games.length,
      idsRequested: sample.length,
      errors: errors.length ? errors : undefined,
      games,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function fetchSigl() {
  const r = await fetch(SIGL_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
      "Accept": "application/json",
    },
  });
  if (!r.ok) throw new Error(`SIGL HTTP ${r.status}`);
  const data = await r.json();
  // SIGL devuelve [{id: "..."}, {id: "..."}, ...] o array de strings
  return data.map(x => typeof x === "string" ? x : x.id).filter(Boolean);
}

async function fetchCatalogBatch(ids) {
  const url = `${CATALOG_URL}?bigIds=${ids.join(",")}&market=US&languages=en-US&fieldsTemplate=Details`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
      "Accept": "application/json",
      "MS-CV": "ReyMidas.1",
    },
  });
  if (!r.ok) throw new Error(`Catalog HTTP ${r.status}`);
  const data = await r.json();
  return data.Products || [];
}

function normalize(p) {
  const id = p.ProductId;
  if (!id) return null;

  const lp = (p.LocalizedProperties || [])[0] || {};
  const title = lp.ProductTitle || lp.ShortTitle;
  if (!title) return null;

  // Imagen: buscamos primero la Poster, después cualquier otra
  let imageUrl = "";
  const images = lp.Images || [];
  const poster =
    images.find(i => i.ImagePurpose === "Poster") ||
    images.find(i => i.ImagePurpose === "BoxArt") ||
    images.find(i => i.ImagePurpose === "SuperHeroArt") ||
    images.find(i => i.ImagePurpose === "Tile") ||
    images[0];
  if (poster) imageUrl = poster.Uri.startsWith("//") ? `https:${poster.Uri}` : poster.Uri;

  // Precio: cada producto tiene varias SKU (full / trial) y cada SKU tiene varias
  // Availabilities. Muchas son de Game Pass/licencia/trial con ListPrice=0 y son
  // ruido. Lo que queremos es el menor ListPrice > 0 de una SKU "full" cuya
  // Availability tenga acción "Purchase".
  const candidates = [];
  for (const sku of (p.DisplaySkuAvailabilities || [])) {
    if (sku.Sku?.SkuType && sku.Sku.SkuType !== "full") continue;
    for (const av of (sku.Availabilities || [])) {
      const actions = av.Actions || [];
      if (!actions.includes("Purchase")) continue;
      const price = av.OrderManagementData?.Price;
      if (!price) continue;
      const list = Number(price.ListPrice);
      if (!list || list <= 0) continue;
      candidates.push({
        list,
        msrp: Number(price.MSRP) || list,
      });
    }
  }
  if (!candidates.length) return null;

  // Mejor oferta = menor list price
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

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
