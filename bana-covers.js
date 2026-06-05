/**
 * GESTOR DE CARÁTULAS DESDE BANA HOSTING
 * ======================================
 *
 * Carga covers en alta resolución desde tu servidor Bana.
 * Fallback a RAWG si no está disponible localmente.
 *
 * USO:
 *   import { getBanaCovers, getCoverUrl } from "./bana-covers.js";
 *
 *   // Al cargar la página
 *   await getBanaCovers();
 *
 *   // Para obtener URL de una carátula
 *   const url = getCoverUrl("game-id", "título fallback");
 */

// Configuración
const BANA_COVERS_URL = process.env.BANA_COVERS_URL ||
  "https://tu-dominio.bana.hosting/covers.json"; // Actualiza con tu URL real

const FALLBACK_PLACEHOLDER = "/img/game-placeholder.png";

// Estado global
let coversDatabase = {};
let dbLoaded = false;
let dbError = null;

/**
 * Carga la base de datos de covers desde Bana (una sola vez)
 * Ejecutar al iniciar la app
 */
export async function getBanaCovers() {
  if (dbLoaded || dbError) return coversDatabase;

  try {
    console.log("[Bana Covers] Cargando base de datos...");

    const res = await fetch(BANA_COVERS_URL, {
      headers: { "Accept": "application/json" },
      cache: "force-cache", // Cachea agresivamente en el browser
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // Valida estructura
    if (!data.covers || typeof data.covers !== "object") {
      throw new Error("Estructura inválida: falta covers");
    }

    coversDatabase = data.covers;
    dbLoaded = true;

    console.log(
      `[Bana Covers] ✅ Base de datos cargada: ${Object.keys(coversDatabase).length} covers`
    );
    return coversDatabase;
  } catch (e) {
    dbError = e;
    console.error(`[Bana Covers] ❌ Error: ${e.message}`);
    console.error(`[Bana Covers] Usando RAWG como fallback`);
    return {};
  }
}

/**
 * Obtiene la URL de cover para un juego
 *
 * Estrategia:
 * 1. Busca en DB local de Bana (por ID del juego o título)
 * 2. Si no existe → RAWG (si está disponible)
 * 3. Si todo falla → placeholder
 */
export function getCoverUrl(gameId, gameTitle = "") {
  // Intenta buscar por ID exacto
  if (coversDatabase[gameId]) {
    return coversDatabase[gameId].url;
  }

  // Intenta buscar por título parcial (si no encontró por ID)
  if (gameTitle) {
    const searchTitle = gameTitle.toLowerCase().trim();
    for (const [id, cover] of Object.entries(coversDatabase)) {
      if ((cover.title || "").toLowerCase().includes(searchTitle)) {
        return cover.url;
      }
    }
  }

  // Fallback: deja que RAWG lo intente (app.js lo maneja)
  return null;
}

/**
 * Estadísticas de la base de datos (para debug)
 */
export function getCoverStats() {
  const total = Object.keys(coversDatabase).length;
  const bySource = {};
  let totalSize = 0;

  for (const cover of Object.values(coversDatabase)) {
    bySource[cover.source] = (bySource[cover.source] || 0) + 1;
    totalSize += cover.sizeKB || 0;
  }

  return {
    loaded: dbLoaded,
    error: dbError?.message || null,
    totalCovers: total,
    bySource,
    estimatedSizeMB: (totalSize / 1024).toFixed(2),
  };
}

/**
 * Preload: carga DB en background sin bloquear
 * Útil para mejorar UX
 */
export function preloadCoversDatabase() {
  if (!dbLoaded && !dbError) {
    getBanaCovers().catch(e => {
      console.warn("[Bana Covers] Preload falló (no crítico):", e.message);
    });
  }
}
