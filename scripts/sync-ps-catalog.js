// Sincroniza el catálogo COMPLETO de PlayStation Store (es-cr) y lo guarda en
// ps-catalog.json via GitHub API. Corre desde GitHub Actions SIN el timeout de
// 30s de Vercel, por lo que pagina muchísimas más páginas que /api/scrape:
//
//   • Categoría principal PS5/PS4 — paginada hasta MAX_PAGES (cientos de páginas)
//   • Páginas de browse general (es-cr y en-us) — captura lo que la categoría omite
//   • Búsquedas por género — para taggear cada juego (acción, rpg, terror, …)
//
// El JSON resultante lo sirve Vercel como archivo estático y el frontend lo
// mergea con /api/scrape (que sigue dando frescura de precios/preventas). Así
// el catálogo deja de depender del scrape en vivo limitado por el timeout.
//
// Reutiliza la lógica de parseo/normalización de api/scrape.js (exportada) para
// que los objetos de juego sean idénticos a los del endpoint en vivo.
//
// Variables de entorno (las provee el runner de GitHub Actions):
//   GITHUB_TOKEN   — token con permiso de escritura sobre el repo
//   GITHUB_REPO    — "owner/repo" (ej: grafitico/rey-midas-digitales)
//   GITHUB_BRANCH  — rama donde commitear (ej: main)
//   MAX_PAGES      — páginas máx por categoría (default 400)
//   BROWSE_PAGES   — páginas de browse por región (default 60)

import {
  fetchAndParse,
  fetchCategoryPaginated,
  CATEGORIES,
  GENRE_SEARCHES,
  PSN_BASE,
  COMING_SOON_BASE,
} from "../api/scrape.js";

const MAX_PAGES = parseInt(process.env.MAX_PAGES || "400", 10);
const BROWSE_PAGES = parseInt(process.env.BROWSE_PAGES || "60", 10);
const OUTPUT_FILE = "ps-catalog.json";
const GITHUB_API = "https://api.github.com";

// Reintentos con backoff: las IPs de los runners de GitHub a veces reciben
// 403/429 de PSN. Reintentamos antes de rendirnos en cada página.
async function withRetry(fn, label, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = 1000 * Math.pow(2, i); // 1s, 2s, 4s, 8s
      console.warn(`[sync-ps] ${label} intento ${i + 1}/${tries} falló: ${e.message} — espero ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function main() {
  console.log("[sync-ps] Iniciando sincronización del catálogo PlayStation...");
  console.log(`[sync-ps] MAX_PAGES=${MAX_PAGES} BROWSE_PAGES=${BROWSE_PAGES}`);

  const stats = {
    pagesFetched: 0, pagesEmpty: 0, pagesFailed: 0,
    addonsExcluded: 0, pcExcluded: 0, browseFound: 0,
  };
  const map = new Map();          // id → juego
  const genreMap = new Map();     // id → Set(tags)

  // 1) Categoría principal, paginada en profundidad (sin timeout).
  for (const catId of CATEGORIES) {
    try {
      const items = await fetchCategoryPaginated(catId, stats, { maxPages: MAX_PAGES });
      for (const g of items) if (!map.has(g.id)) map.set(g.id, g);
      console.log(`[sync-ps] Categoría ${catId}: ${items.length} juegos — acumulado ${map.size}`);
    } catch (e) {
      console.warn(`[sync-ps] Categoría ${catId} falló: ${e.message}`);
    }
  }

  // 2) Páginas de browse general en ambas regiones — la enumeración más amplia
  //    que PSN expone públicamente. Captura juegos fuera de la categoría curada.
  for (const base of [PSN_BASE, COMING_SOON_BASE]) {
    let emptyStreak = 0;
    for (let n = 1; n <= BROWSE_PAGES; n++) {
      try {
        const games = await withRetry(
          () => fetchAndParse(`${base}/pages/browse/${n}`, stats),
          `browse ${base}/${n}`
        );
        if (!games.length) {
          if (++emptyStreak >= 3) break; // 3 páginas vacías seguidas = fin
          continue;
        }
        emptyStreak = 0;
        let added = 0;
        for (const g of games) {
          if (!map.has(g.id)) { map.set(g.id, g); added++; stats.browseFound++; }
        }
        if (added) console.log(`[sync-ps] browse ${base.includes("en-us") ? "en-us" : "es-cr"}/${n}: +${added} — acumulado ${map.size}`);
      } catch (e) {
        console.warn(`[sync-ps] browse ${base}/${n} agotó reintentos: ${e.message}`);
        if (++emptyStreak >= 3) break;
      }
      await sleep(150);
    }
  }

  // 3) Búsquedas por género — alimentan los tags de cada juego.
  for (const { tag, query } of GENRE_SEARCHES) {
    try {
      const games = await withRetry(
        () => fetchAndParse(`${PSN_BASE}/search/${encodeURIComponent(query)}`, stats),
        `género ${tag}`
      );
      for (const g of games) {
        if (!genreMap.has(g.id)) genreMap.set(g.id, new Set());
        genreMap.get(g.id).add(tag);
        // Un juego que solo aparece en una búsqueda de género igual se suma.
        if (!map.has(g.id)) map.set(g.id, g);
      }
      console.log(`[sync-ps] género ${tag}: ${games.length} resultados`);
    } catch (e) {
      console.warn(`[sync-ps] género ${tag} falló: ${e.message}`);
    }
    await sleep(150);
  }

  // 4) Merge de tags de género + facetas (edición/preventa/estreno) y orden.
  const games = Array.from(map.values())
    .map(g => {
      const direct = new Set(g.directGenres || []);
      const search = genreMap.get(g.id) || new Set();
      const merged = new Set([...direct, ...search]);
      if (g.type === "edition" || g.type === "bundle") merged.add("edicion");
      if (g.comingSoon) merged.add("preventa");
      const { directGenres, ...rest } = g;
      return { ...rest, genres: Array.from(merged) };
    })
    .sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return (b.discount || 0) - (a.discount || 0);
    });

  console.log(`[sync-ps] Total juegos únicos: ${games.length}`);
  console.log(`[sync-ps] Stats:`, JSON.stringify(stats));

  // Salvaguarda: si el scrape devolvió casi nada (PSN bloqueó las IPs del
  // runner con 403), abortamos SIN commitear para no pisar el catálogo bueno.
  if (games.length < 50) {
    console.error(`[sync-ps] Solo ${games.length} juegos — probable bloqueo de PSN. Abortando sin commitear.`);
    process.exit(1);
  }

  const catalog = {
    updatedAt: new Date().toISOString(),
    count: games.length,
    games,
  };
  await commitCatalog(catalog);
  console.log(`[sync-ps] ✓ Listo — ${games.length} juegos en ${OUTPUT_FILE}`);
}

// ===== GitHub commit (mismo patrón que sync-xbox-catalog.js) =====

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en el entorno");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rey-midas-ps-sync",
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
    sha = undefined; // archivo nuevo
  } else {
    throw new Error(`GitHub GET ${getRes.status}: ${await getRes.text()}`);
  }

  const putUrl = `${GITHUB_API}/repos/${repo}/contents/${OUTPUT_FILE}`;
  const body = {
    message: `chore: sync PS catalog — ${catalog.count} juegos [${new Date().toISOString().slice(0, 10)}]`,
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
  console.log(`[sync-ps] Commit: ${result.commit?.sha?.slice(0, 7)} en ${repo}@${branch}`);
}

// ===== Utilidades =====

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error("[sync-ps] Error fatal:", e);
  process.exit(1);
});
