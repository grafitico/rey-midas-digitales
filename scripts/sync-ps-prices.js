// Precios frescos de PlayStation cada pocas horas (ps-prices.json).
//
// El catálogo completo (sync-ps-catalog.js) corre una vez al día y tarda ~30
// min; el scrape en vivo (/api/scrape) solo alcanza la categoría principal
// (casi toda PS4). Así, las ofertas de los juegos PS5 llegaban con hasta un día
// de atraso — y lo peor, una oferta que ya terminó seguía mostrándose rebajada
// (vender por debajo del costo). Este script lee SOLO las dos categorías
// (PS4 + PS5, ~3 min) y guarda un archivo chico { id: [precio, precioLista] }
// que el frontend aplica encima de ps-catalog.json. El scrape en vivo sigue
// ganando sobre ambos.
//
// Solo commitea si algún precio cambió (cada commit a main redepliega Vercel).

import { readFileSync } from "fs";
import { fetchCategoryPaginated, CATEGORIES, PS5_CATEGORY } from "../api/scrape.js";

const OUTPUT_FILE = "ps-prices.json";
const GITHUB_API = "https://api.github.com";

async function main() {
  const stats = { pagesFetched: 0, pagesEmpty: 0, pagesFailed: 0, addonsExcluded: 0 };
  const prices = {};
  for (const catId of [...CATEGORIES, PS5_CATEGORY]) {
    const items = await fetchCategoryPaginated(catId, stats, { maxPages: 400, chunkSize: 8, delayMs: 1200 });
    for (const g of items) {
      if (g.priceUSD > 0) prices[g.id] = [g.priceUSD, g.originalPriceUSD || g.priceUSD];
    }
    console.log(`[sync-prices] Categoría ${catId}: ${items.length} productos`);
  }
  const count = Object.keys(prices).length;
  const onSale = Object.values(prices).filter(([p, o]) => o > p).length;
  console.log(`[sync-prices] ${count} precios (${onSale} en oferta). Stats: ${JSON.stringify(stats)}`);

  // Salvaguarda: si PSN bloqueó al runner (403) llegaría casi vacío; no pisamos
  // los precios buenos con un archivo roto.
  if (count < 5000 || stats.pagesFailed > 20) {
    console.error(`[sync-prices] Corrida incompleta (${count} precios, ${stats.pagesFailed} páginas fallidas). No se commitea.`);
    process.exit(1);
  }

  let prev = {};
  try { prev = JSON.parse(readFileSync(OUTPUT_FILE, "utf8")).prices || {}; } catch {}
  const changed = Object.keys(prices).filter(id => String(prev[id]) !== String(prices[id])).length
    + Object.keys(prev).filter(id => !(id in prices)).length;
  if (!changed) {
    console.log("[sync-prices] Sin cambios de precio — no se commitea.");
    return;
  }
  console.log(`[sync-prices] ${changed} precios cambiaron.`);
  await commitFile({ updatedAt: new Date().toISOString(), count, prices }, `chore: precios PS — ${changed} cambios, ${onSale} en oferta`);
}

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en el entorno");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "rey-midas-ps-prices" };
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
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(data), "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) throw new Error(`GitHub PUT ${putRes.status}: ${(await putRes.text()).slice(0, 300)}`);
  const result = await putRes.json();
  console.log(`[sync-prices] Commit: ${result.commit?.sha?.slice(0, 7)} en ${repo}@${branch}`);
}

main().catch(e => {
  console.error("[sync-prices] Error fatal:", e);
  process.exit(1);
});
