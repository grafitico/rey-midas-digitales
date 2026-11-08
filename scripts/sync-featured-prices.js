// Precios en vivo de los juegos destacados (featured-games.json) → featured-prices.json.
//
// Antes los calculaba /api/featured-prices en Vercel: ~150 búsquedas en PSN que
// se recalculaban solas cada hora, entrara o no gente. Junto con /api/scrape
// agotaron el tiempo de CPU del plan gratuito (Fluid Active CPU, nov 2026) y
// Vercel pausó el sitio. Ahora lo corre GitHub Actions cada 3 h (mismo
// workflow que los precios PS) y la web lee el archivo estático: cero servidor.
//
// Reutiliza la misma lógica del endpoint (api/featured-prices.js) llamándolo
// con un req/res de mentira. Solo commitea si algún precio cambió.

import { readFileSync } from "fs";
import handler from "../api/featured-prices.js";

const OUTPUT_FILE = "featured-prices.json";
const GITHUB_API = "https://api.github.com";

function runHandler() {
  return new Promise((resolve) => {
    let statusCode = 200;
    const res = {
      setHeader() {},
      status(code) { statusCode = code; return res; },
      json(body) { resolve({ statusCode, body }); },
      end() { resolve({ statusCode, body: null }); },
    };
    handler({ method: "GET", query: {}, headers: {} }, res);
  });
}

async function main() {
  const { statusCode, body } = await runHandler();
  if (statusCode !== 200 || !body?.success) {
    console.error(`[featured-prices] Falló (${statusCode}): ${body?.error || "sin respuesta"}`);
    process.exit(1);
  }
  const resolved = Object.keys(body.prices || {}).length;
  console.log(`[featured-prices] ${resolved} precios resueltos, ${body.unresolved?.length || 0} sin resolver. Stats: ${JSON.stringify(body.stats)}`);

  // Salvaguarda: si PSN bloqueó al runner, no pisamos los precios buenos con nada.
  let prev = {};
  try { prev = JSON.parse(readFileSync(OUTPUT_FILE, "utf8")).prices || {}; } catch {}
  if (resolved < Math.max(10, Object.keys(prev).length * 0.5)) {
    console.error(`[featured-prices] Muy pocos precios (${resolved}, antes ${Object.keys(prev).length}): probable bloqueo de PSN. No se commitea.`);
    process.exit(1);
  }
  const same = JSON.stringify(prev) === JSON.stringify(body.prices);
  if (same) { console.log("[featured-prices] Sin cambios — no se commitea."); return; }

  await commitFile(
    { updatedAt: new Date().toISOString(), success: true, prices: body.prices, unresolved: body.unresolved },
    `chore: precios destacados — ${resolved} resueltos`,
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
