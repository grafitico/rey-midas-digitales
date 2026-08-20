// Sincroniza el catálogo COMPLETO de PlayStation Store (es-cr) y lo guarda en
// ps-catalog.json via GitHub API. Corre desde GitHub Actions SIN el timeout de
// 30s de Vercel, por lo que pagina muchísimas más páginas que /api/scrape:
//
//   • Categoría principal PS5/PS4 — paginada hasta MAX_PAGES (cientos de páginas)
//   • Páginas de browse general (es-cr y en-us) — captura lo que la categoría omite
//   • Género vía la faceta productGenres de categoryGridRetrieve — taggea cada
//     juego (acción, rpg, terror, …) filtrando la misma consulta por género
//   • Rescate por franquicia (buscador de PSN) — la categoría de navegación
//     resultó ser un subconjunto curado: juegos viejos como Call of Duty:
//     Black Ops 4 (2018) tienen página de producto viva pero no salen ahí.
//     El buscador SÍ los indexa, así que buscamos por nombre de franquicia
//     y sumamos al catálogo lo que la categoría se saltó.
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
  fetchGenreProductIds,
  fetchSearchProducts,
  CATEGORIES,
  PS5_CATEGORY,
  GENRE_FACET_MAP,
  CATALOG_GAP_SEARCH_TERMS,
  PSN_BASE,
  COMING_SOON_BASE,
} from "../api/scrape.js";

// Categorías a paginar: la principal (PS4/CUSA) + la de "All PS5 Games" (PPSA).
// Sin las dos, el catálogo quedaba 99% PS4 y faltaban los PS5 modernos.
const SYNC_CATEGORIES = [...CATEGORIES, PS5_CATEGORY];

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

  // 1) Categorías principales (PS4 + PS5), paginadas en profundidad (sin timeout).
  //    Lotes chicos (8) + pausa (1.2s) entre lotes para NO gatillar el 403 de
  //    rate-limit de PSN, que en la corrida anterior dejó páginas PS5 sin leer
  //    (faltaban MK1 y otros). Más lento, pero cobertura completa.
  for (const catId of SYNC_CATEGORIES) {
    try {
      const items = await fetchCategoryPaginated(catId, stats, {
        maxPages: MAX_PAGES, chunkSize: 8, delayMs: 1200,
      });
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

  // 3) Género vía la faceta `productGenres` de categoryGridRetrieve — mismo
  //    mecanismo que el catálogo, filtrado por género. Se corre por cada
  //    categoría (PS4 + PS5, tienen conteos de faceta independientes).
  for (const [tag, facetKey] of Object.entries(GENRE_FACET_MAP)) {
    let total = 0;
    for (const catId of SYNC_CATEGORIES) {
      try {
        const ids = await withRetry(
          () => fetchGenreProductIds(catId, facetKey, stats),
          `género ${tag}`
        );
        for (const id of ids) {
          if (!genreMap.has(id)) genreMap.set(id, new Set());
          genreMap.get(id).add(tag);
        }
        total += ids.length;
      } catch (e) {
        console.warn(`[sync-ps] género ${tag} (${catId}) falló: ${e.message}`);
      }
      await sleep(150);
    }
    console.log(`[sync-ps] género ${tag}: ${total} resultados`);
  }

  // 4) Rescate por franquicia vía el buscador de PSN (getSearchResults):
  //    suma al catálogo juegos que la categoría de navegación se saltó.
  //    Confirmado con Black Ops 4: buscar "call of duty" (128 resultados,
  //    paginados completos) encuentra el juego base pero NUNCA la edición
  //    Digital Deluxe — el buscador de PSN da resultados genuinamente
  //    distintos según qué tan específico sea el término, no un
  //    superconjunto. Por eso el paso 4b: para cada juego BASE (full-game,
  //    sin edición) que este paso descubre, se hace una búsqueda de
  //    seguimiento por su nombre exacto — así sí aparecen las ediciones
  //    Deluxe/GOTY hermanas que "call of duty" solo no encontró.
  const followUpTitles = new Set();
  for (const term of CATALOG_GAP_SEARCH_TERMS) {
    try {
      const items = await withRetry(
        () => fetchSearchProducts(term, stats, { chunkSize: 4, delayMs: 150 }),
        `rescate "${term}"`
      );
      let added = 0;
      for (const g of items) {
        if (!map.has(g.id)) {
          map.set(g.id, g);
          added++;
          if (g.type === "full-game") followUpTitles.add(g.title);
        }
      }
      if (added) console.log(`[sync-ps] rescate "${term}": +${added} nuevos — acumulado ${map.size}`);
    } catch (e) {
      console.warn(`[sync-ps] rescate "${term}" falló: ${e.message}`);
    }
    await sleep(150);
  }

  // 4b) Seguimiento por nombre exacto de cada juego base recién descubierto,
  //     para atrapar ediciones Deluxe/GOTY que el término de franquicia solo
  //     no trae (ver comentario arriba).
  let followUpAdded = 0;
  for (const title of followUpTitles) {
    try {
      const items = await withRetry(
        () => fetchSearchProducts(title, stats, { chunkSize: 4, delayMs: 150 }),
        `seguimiento "${title}"`
      );
      for (const g of items) {
        if (!map.has(g.id)) { map.set(g.id, g); followUpAdded++; }
      }
    } catch (e) {
      console.warn(`[sync-ps] seguimiento "${title}" falló: ${e.message}`);
    }
    await sleep(150);
  }
  if (followUpAdded) console.log(`[sync-ps] seguimiento por título: +${followUpAdded} nuevos (ediciones hermanas) — acumulado ${map.size}`);

  // 5) Merge de tags de género + facetas (edición/preventa/estreno) y orden.
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
