#!/usr/bin/env node
/**
 * COMPILAR COVERS DESDE API DE RAWG
 * =================================
 * Lee featured-games.json y obtiene carátulas de RAWG
 * Luego las guarda en covers.json para replicar a Bana
 *
 * USO: npm run build-covers
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

// ============================================================================
// CARGAR .env.local MANUALMENTE
// ============================================================================
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.trim() && !line.startsWith("#")) {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length > 0) {
          const value = valueParts.join("=").trim();
          process.env[key.trim()] = value;
        }
      }
    }
  }
}

loadEnv();

// ============================================================================
// CARGAR JUEGOS DE featured-games.json
// ============================================================================
function loadFeaturedGames() {
  try {
    const content = readFileSync("featured-games.json", "utf-8");
    const data = JSON.parse(content);
    return data.games || [];
  } catch (e) {
    console.error("❌ Error leyendo featured-games.json:", e.message);
    return [];
  }
}

// ============================================================================
// OBTENER COVERS DESDE RAWG
// ============================================================================
async function getCoversFromRAWG(games) {
  console.log(`\n🔍 Buscando carátulas en RAWG para ${games.length} juegos...`);

  const covers = {};
  let count = 0;

  for (const game of games) {
    try {
      // RAWG API pública (no requiere key para búsqueda básica)
      const searchUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(game.title)}&page_size=1`;

      const response = await fetch(searchUrl, {
        timeout: 5000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!response.ok) {
        console.log(`  ⚠️  ${game.title}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const result = data.results?.[0];

      if (!result || !result.background_image) {
        console.log(`  ⚠️  ${game.title}: No image found`);
        continue;
      }

      covers[game.id] = {
        source: "rawg",
        platform: game.platform,
        title: game.title,
        url: result.background_image,
      };

      count++;
      console.log(`  ✓ ${game.title} (${count}/${games.length})`);

      // Rate limiting (100ms entre requests)
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error(`  ✗ ${game.title}: ${e.message}`);
    }
  }

  return covers;
}

// ============================================================================
// GENERAR COVERS.JSON
// ============================================================================
function generateCoversJSON(covers) {
  const db = {
    generated: new Date().toISOString(),
    totalCovers: Object.keys(covers).length,
    description: "Base de datos de carátulas compiladas desde RAWG",
    covers,
  };

  return db;
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("   🎮 COMPILAR COVERS DESDE RAWG - Rey Midas");
  console.log("═══════════════════════════════════════════════════════════");

  const games = loadFeaturedGames();
  console.log(`\n✅ Cargados ${games.length} juegos de featured-games.json`);

  const covers = await getCoversFromRAWG(games);
  console.log(`\n✅ Encontradas carátulas: ${Object.keys(covers).length}`);

  const db = generateCoversJSON(covers);
  writeFileSync("covers.json", JSON.stringify(db, null, 2));

  console.log(`\n✅ Guardado: covers.json`);
  console.log(`\n📊 Estadísticas:`);
  console.log(`   Total juegos: ${games.length}`);
  console.log(`   Con carátula: ${Object.keys(covers).length}`);
  console.log(`   Éxito: ${Math.round((Object.keys(covers).length / games.length) * 100)}%`);
}

main().catch(e => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
