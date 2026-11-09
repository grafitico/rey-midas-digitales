// Precios en vivo de los juegos destacados (featured-games.json) → featured-prices.json.
//
// Antes los calculaba /api/featured-prices en Vercel leyendo el HTML de la PS
// Store. Ese HTML dejó de traer los productos con el rediseño de PSN de agosto
// 2026, así que desde entonces no resolvía NINGÚN precio (los destacados
// mostraban el precio fijo escrito a mano) y aun así gastaba CPU cada hora:
// junto con /api/scrape agotó el plan gratuito y Vercel pausó el sitio.
//
// Ahora lo corre GitHub Actions cada 3 h (workflow de precios PS):
//   1) busca cada destacado en el catálogo ya descargado (ps-catalog.json +
//      ps-prices.json), sin red;
//   2) lo que no aparezca, lo busca en el buscador GraphQL de PSN (el mismo que
//      usa el sync del catálogo y que sí funciona).
// Se exige mismo juego Y misma edición (editionKey) y se descartan monedas y
// complementos (clasificación de PSN). Solo commitea si algún precio cambió.

import { readFileSync } from "fs";
import { editionKey } from "../api/featured-prices.js";
import { fetchSearchProducts } from "../api/scrape.js";

const OUTPUT_FILE = "featured-prices.json";
const GITHUB_API = "https://api.github.com";

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function toEntry(g) {
  return {
    priceUSD: g.priceUSD,
    originalPriceUSD: g.originalPriceUSD || g.priceUSD,
    onSale: !!g.onSale,
    discount: g.discount || 0,
    url: g.url || `https://store.playstation.com/es-cr/product/${g.id}`,
    psnId: g.id,
    platform: g.platform,
    imageUrl: g.imageUrl || "",
  };
}

// Mejor candidato: misma edición, plataforma compatible, el más barato.
function pick(game, candidates) {
  const key = editionKey(game.title);
  let list = candidates.filter(p => p.priceUSD > 0 && p.type !== "add-on" && editionKey(p.title) === key);
  const wantsPS5 = /PS5/.test(game.platform) && !/PS4/.test(game.platform);
  const wantsPS4 = /PS4/.test(game.platform) && !/PS5/.test(game.platform);
  if (wantsPS5) { const f = list.filter(p => /PS5/.test(p.platform)); if (f.length) list = f; }
  if (wantsPS4) { const f = list.filter(p => /PS4/.test(p.platform)); if (f.length) list = f; }
  list.sort((a, b) => a.priceUSD - b.priceUSD);
  return list[0] || null;
}

async function main() {
  const featured = (readJson("featured-games.json")?.games || []).filter(g => g && g.title);
  const fresh = readJson("ps-prices.json")?.prices || {};
  const catalog = (readJson("ps-catalog.json")?.games || []).map(g => {
    const p = fresh[g.id];
    if (!p) return g;
    const [price, original] = p, onSale = original > price;
    return { ...g, priceUSD: price, originalPriceUSD: original, onSale, discount: onSale ? Math.round((1 - price / original) * 100) : 0 };
  });
  const byKey = new Map();
  for (const g of catalog) {
    const k = editionKey(g.title);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(g);
  }
  const byId = new Map(catalog.map(g => [g.id, g]));

  const prices = {};
  let fromCatalog = 0, fromSearch = 0;
  const pending = [];
  for (const game of featured) {
    const byPsnId = game.psnId && byId.get(game.psnId);
    const hit = (byPsnId && byPsnId.priceUSD > 0 ? byPsnId : null) || (!game.psnId && pick(game, byKey.get(editionKey(game.title)) || []));
    if (hit) { prices[game.id] = toEntry(hit); fromCatalog++; }
    else pending.push(game);
  }
  for (const game of pending) {
    try {
      // "buscar": texto de búsqueda cuando PSN lo publica con otro nombre (en
      // español, otra edición). Si el destacado trae psnId, gana ese producto.
      const results = await fetchSearchProducts(game.buscar || game.title, null, { maxItems: 48 });
      const hit = game.psnId ? results.find(p => p.id === game.psnId && p.priceUSD > 0) : pick(game, results);
      if (hit) { prices[game.id] = toEntry(hit); fromSearch++; }
    } catch (e) {
      console.warn(`[featured-prices] búsqueda "${game.title}" falló: ${e.message}`);
    }
    await sleep(200);
  }
  const unresolved = featured.filter(g => !prices[g.id]).map(g => ({ id: g.id, title: g.title, platform: g.platform, precioFijoUSD: g.priceUSD }));
  const resolved = Object.keys(prices).length;
  console.log(`[featured-prices] ${resolved}/${featured.length} resueltos (${fromCatalog} del catálogo, ${fromSearch} del buscador). Sin resolver: ${unresolved.map(u => u.title).join(" | ")}`);

  // DRY_RUN=1: muestra a qué producto de PSN quedó emparejado cada destacado y no publica nada.
  if (process.env.DRY_RUN) {
    for (const g of featured) if (prices[g.id]) console.log(`${g.id}\t${g.title}\t${g.priceUSD}\t${prices[g.id].psnId}\t${prices[g.id].priceUSD}`);
    return;
  }

  // Salvaguarda: si PSN bloqueó al runner y el catálogo vino vacío, no pisamos lo bueno.
  const prev = readJson(OUTPUT_FILE)?.prices || {};
  if (resolved < Math.max(10, Object.keys(prev).length * 0.5)) {
    console.error(`[featured-prices] Muy pocos precios (${resolved}, antes ${Object.keys(prev).length}). No se commitea.`);
    process.exit(1);
  }
  if (JSON.stringify(prev) === JSON.stringify(prices)) { console.log("[featured-prices] Sin cambios — no se commitea."); return; }
  await commitFile(
    { updatedAt: new Date().toISOString(), success: true, prices, unresolved },
    `chore: precios destacados — ${resolved}/${featured.length} resueltos`,
  );
}

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en el entorno");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "rey-midas-featured-prices" };
}

async function commitFile(data, message) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!repo) throw new Error("Falta GITHUB_REPO en el entorno");
  const getRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${OUTPUT_FILE}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders() });
  let sha;
  if (getRes.ok) sha = (await getRes.json()).sha;
  else if (getRes.status !== 404) throw new Error(`GitHub GET ${getRes.status}: ${await getRes.text()}`);
  const putRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${OUTPUT_FILE}`, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(data), "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }),
  });
  if (!putRes.ok) throw new Error(`GitHub PUT ${putRes.status}: ${(await putRes.text()).slice(0, 300)}`);
  console.log(`[featured-prices] Commit: ${(await putRes.json()).commit?.sha?.slice(0, 7)} en ${repo}@${branch}`);
}

main().catch(e => { console.error("[featured-prices] Error fatal:", e); process.exit(1); });
