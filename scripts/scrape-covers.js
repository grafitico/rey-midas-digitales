#!/usr/bin/env node
/**
 * SCRAPER PROFESIONAL DE CARÁTULAS
 * ================================
 * Recolecta covers en alta calidad de múltiples fuentes:
 * - Steam (mejor calidad)
 * - GOG (alternativa de calidad)
 * - Epic Games (cobertura)
 * - RAWG (como fallback)
 *
 * Optimiza a WebP, sube a Bana Hosting, genera base de datos
 *
 * USO:
 *   node scripts/scrape-covers.js --source=steam --limit=1000
 *   node scripts/scrape-covers.js --source=all --upload-to-bana
 */

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import sharp from "sharp";
import { Client } from "basic-ftp";
import { createWriteStream, createReadStream } from "fs";
import { mkdir, writeFile } from "fs/promises";

const BANA_CONFIG = {
  host: process.env.BANA_HOST || "ftp.banahosting.com",
  user: process.env.BANA_USER || "",
  password: process.env.BANA_PASSWORD || "",
  remotePath: "/public_html/covers", // Ajusta según tu dominio
  publicUrl: process.env.BANA_PUBLIC_URL || "https://tu-dominio.bana.hosting/covers",
};

const LOCAL_COVERS_DIR = path.join(process.cwd(), "covers-temp");
const COVERS_DB_FILE = path.join(process.cwd(), "covers-database.json");

// ============================================================================
// SCRAPER DE STEAM (alternativa: usa RAWG para obtener metadatos de juegos Steam)
// ============================================================================
async function scrapeFromSteam(limit = 1000) {
  console.log(`\n📦 STEAM (via RAWG): Buscando ${limit} juegos...`);

  const covers = {};
  let count = 0;

  // Lista de IDs RAWG de juegos populares en Steam
  // Formato: { rawgId, title, steamId }
  const popularGames = [
    { rawgId: "elden-ring", title: "Elden Ring" },
    { rawgId: "the-witcher-3", title: "The Witcher 3" },
    { rawgId: "cyberpunk-2077", title: "Cyberpunk 2077" },
    { rawgId: "hogwarts-legacy", title: "Hogwarts Legacy" },
    { rawgId: "baldurs-gate-3", title: "Baldur's Gate 3" },
    { rawgId: "starfield", title: "Starfield" },
    { rawgId: "palworld", title: "Palworld" },
    { rawgId: "dragon-age-the-veilguard", title: "Dragon Age: The Veilguard" },
    { rawgId: "final-fantasy-vii-remake", title: "Final Fantasy VII Remake" },
    { rawgId: "the-last-of-us-part-i", title: "The Last of Us Part I" },
    { rawgId: "tekken-8", title: "Tekken 8" },
    { rawgId: "hades", title: "Hades" },
    { rawgId: "hollow-knight-silksong", title: "Hollow Knight: Silksong" },
    { rawgId: "it-takes-two", title: "It Takes Two" },
    { rawgId: "deep-rock-galactic", title: "Deep Rock Galactic" },
    { rawgId: "monster-hunter-world", title: "Monster Hunter: World" },
    { rawgId: "sekiro-shadows-die-twice", title: "Sekiro: Shadows Die Twice" },
    { rawgId: "dark-souls-3", title: "Dark Souls 3" },
    { rawgId: "bloodborne", title: "Bloodborne" },
    { rawgId: "zelda-breath-of-the-wild", title: "Zelda: Breath of the Wild" },
    // Agregar más según necesidad
  ];

  for (const game of popularGames) {
    if (count >= limit) break;

    try {
      // RAWG tiene URLs públicas de carátulas
      // Buscamos el juego en RAWG
      const searchUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(game.title)}&page_size=1`;
      const res = await fetch(searchUrl, { timeout: 5000 });

      if (!res.ok) {
        console.log(`  ⚠️  ${game.title}: API error`);
        continue;
      }

      const data = await res.json();
      const result = data.results?.[0];

      if (!result || !result.background_image) {
        console.log(`  ⚠️  ${game.title}: No image found`);
        continue;
      }

      const gameId = `steam-${game.rawgId}`;
      covers[gameId] = {
        source: "steam",
        title: game.title,
        imageUrl: result.background_image,
        downloaded: false,
        optimized: false,
      };
      count++;
      console.log(`  ✓ ${gameId}`);

      // Rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error(`  ✗ ${game.title}: ${e.message}`);
    }
  }

  console.log(`\n✅ STEAM: ${count} juegos encontrados`);
  return covers;
}

// ============================================================================
// SCRAPER DE GOG (alternativa, buena calidad)
// ============================================================================
async function scrapeFromGOG(limit = 500) {
  console.log(`\n📦 GOG: Buscando ${limit} juegos...`);

  const covers = {};
  let count = 0;

  // GOG API publica (sin auth requerida para búsqueda)
  try {
    const res = await fetch(
      "https://api.gog.com/products?limit=50&order=desc",
      { timeout: 10000 }
    );
    const data = await res.json();

    if (data.products) {
      for (const product of data.products.slice(0, limit)) {
        if (product.coverImage) {
          const gameId = `gog-${product.id}`;
          covers[gameId] = {
            source: "gog",
            gogId: product.id,
            title: product.title,
            imageUrl: `https:${product.coverImage}`,
            downloaded: false,
            optimized: false,
          };
          count++;
          if (count >= limit) break;
        }
      }
    }
    console.log(`✅ GOG: ${count} juegos encontrados`);
  } catch (e) {
    console.error(`⚠️  GOG API error: ${e.message}`);
  }

  return covers;
}

// ============================================================================
// SCRAPER DE RAWG (fallback, ya tienes acceso)
// ============================================================================
async function scrapeFromRAWG(limit = 2000) {
  console.log(`\n📦 RAWG: Buscando ${limit} juegos...`);

  const covers = {};
  let count = 0;
  const apiKey = process.env.RAWG_API_KEY || "";

  if (!apiKey) {
    console.log("⚠️  RAWG_API_KEY no configurada, saltando RAWG");
    return covers;
  }

  try {
    // RAWG tiene endpoint de búsqueda masiva
    const pageSize = 40;
    const pages = Math.ceil(limit / pageSize);

    for (let page = 1; page <= pages && count < limit; page++) {
      const url = `https://api.rawg.io/api/games?key=${apiKey}&page=${page}&page_size=${pageSize}&ordering=-metacritic`;
      const res = await fetch(url, { timeout: 5000 });
      const data = await res.json();

      if (!data.results) break;

      for (const game of data.results) {
        if (game.background_image && count < limit) {
          const gameId = `rawg-${game.id}`;
          covers[gameId] = {
            source: "rawg",
            rawgId: game.id,
            title: game.name,
            imageUrl: game.background_image,
            downloaded: false,
            optimized: false,
          };
          count++;
        }
      }

      console.log(`  ✓ Página ${page}: ${count}/${limit}`);
      // Rate limiting: RAWG permite ~4 req/sec
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {
    console.error(`⚠️  RAWG error: ${e.message}`);
  }

  console.log(`✅ RAWG: ${count} juegos encontrados`);
  return covers;
}

// ============================================================================
// DESCARGAR Y OPTIMIZAR IMÁGENES
// ============================================================================
async function downloadAndOptimize(covers, batchSize = 10) {
  console.log(`\n🖼️  Descargando y optimizando ${Object.keys(covers).length} imágenes...`);

  await mkdir(LOCAL_COVERS_DIR, { recursive: true });

  let processed = 0;
  const entries = Object.entries(covers);

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async ([gameId, meta]) => {
        try {
          const response = await fetch(meta.imageUrl, {
            timeout: 10000,
            headers: { "User-Agent": "Mozilla/5.0" },
          });

          if (!response.ok) {
            console.log(`  ⚠️  ${gameId}: HTTP ${response.status}`);
            return;
          }

          const buffer = await response.buffer();

          // Detecta formato original
          const isWebP = buffer.slice(0, 4).toString("hex") === "52494646";

          // Redimensiona a 600x900 (estándar de carátulas)
          // Calidad WebP: 85 = balance perfecto entre tamaño y calidad
          const optimized = await sharp(buffer)
            .resize(600, 900, {
              fit: "cover",
              position: "center",
            })
            .webp({ quality: 85, alphaQuality: 85 })
            .toBuffer();

          const filename = `${gameId}.webp`;
          const filepath = path.join(LOCAL_COVERS_DIR, filename);
          await writeFile(filepath, optimized);

          covers[gameId].localFile = filename;
          covers[gameId].optimized = true;
          covers[gameId].sizeKB = Math.round(optimized.length / 1024);

          console.log(
            `  ✓ ${gameId} (${covers[gameId].sizeKB}KB)`
          );
        } catch (e) {
          console.error(`  ✗ ${gameId}: ${e.message}`);
        }
      })
    );

    console.log(`  Procesadas: ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
  }

  const optimized = Object.values(covers).filter(c => c.optimized).length;
  console.log(`\n✅ Optimizadas: ${optimized}/${entries.length}`);
}

// ============================================================================
// SUBIR A BANA HOSTING (FTP)
// ============================================================================
async function uploadToBana(covers) {
  if (!BANA_CONFIG.user || !BANA_CONFIG.password) {
    console.log(
      "\n⚠️  Credenciales de Bana no configuradas. Saltando upload."
    );
    console.log("   Configura: BANA_HOST, BANA_USER, BANA_PASSWORD");
    return;
  }

  console.log(`\n📤 Conectando a Bana (${BANA_CONFIG.host})...`);

  const client = new Client();

  try {
    await client.access({
      host: BANA_CONFIG.host,
      user: BANA_CONFIG.user,
      password: BANA_CONFIG.password,
    });

    console.log("✅ Conectado a Bana");

    // Crea carpeta de covers si no existe
    try {
      await client.cd(BANA_CONFIG.remotePath);
    } catch {
      console.log(`  Creando ${BANA_CONFIG.remotePath}...`);
      await client.ensureDir(BANA_CONFIG.remotePath);
    }

    let uploaded = 0;
    const filesToUpload = Object.entries(covers).filter(
      ([_, meta]) => meta.optimized
    );

    for (const [gameId, meta] of filesToUpload) {
      try {
        const localPath = path.join(LOCAL_COVERS_DIR, meta.localFile);
        await client.uploadFrom(localPath, meta.localFile);

        covers[gameId].uploadedToBANA = true;
        covers[gameId].publicUrl = `${BANA_CONFIG.publicUrl}/${meta.localFile}`;

        uploaded++;
        console.log(`  ✓ ${meta.localFile}`);
      } catch (e) {
        console.error(`  ✗ ${gameId}: ${e.message}`);
      }
    }

    await client.close();
    console.log(`\n✅ Subidas: ${uploaded}/${filesToUpload.length}`);
  } catch (e) {
    console.error(`\n❌ Error FTP: ${e.message}`);
  }
}

// ============================================================================
// GENERAR BASE DE DATOS (covers.json)
// ============================================================================
async function generateDatabase(covers) {
  console.log(`\n📊 Generando base de datos...`);

  const db = {
    generated: new Date().toISOString(),
    totalCovers: Object.keys(covers).length,
    uploadedCovers: Object.values(covers).filter(c => c.uploadedToBANA).length,
    covers: {},
  };

  // Estructura: game_id → { source, publicUrl, size }
  for (const [gameId, meta] of Object.entries(covers)) {
    if (meta.publicUrl) {
      db.covers[gameId] = {
        source: meta.source,
        url: meta.publicUrl,
        sizeKB: meta.sizeKB || 0,
        title: meta.title || "",
      };
    }
  }

  await writeFile(COVERS_DB_FILE, JSON.stringify(db, null, 2));
  console.log(`✅ Base de datos generada: ${COVERS_DB_FILE}`);
  console.log(`   Total covers: ${db.totalCovers}`);
  console.log(`   Subidas a Bana: ${db.uploadedCovers}`);

  return db;
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  const source = args.find(a => a.startsWith("--source="))?.split("=")[1] || "steam";
  const limit = parseInt(
    args.find(a => a.startsWith("--limit="))?.split("=")[1] || "500"
  );
  const uploadToBanaFlag = args.includes("--upload-to-bana");

  console.log("═══════════════════════════════════════════════════════════");
  console.log("   🎮 SCRAPER DE CARÁTULAS PROFESIONAL - Rey Midas");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Source: ${source} | Limit: ${limit} | Upload: ${uploadToBanaFlag}`);

  let allCovers = {};

  // Ejecuta según fuente
  if (source === "steam" || source === "all") {
    Object.assign(allCovers, await scrapeFromSteam(limit));
  }
  if (source === "gog" || source === "all") {
    Object.assign(allCovers, await scrapeFromGOG(Math.ceil(limit / 3)));
  }
  if (source === "rawg" || source === "all") {
    Object.assign(allCovers, await scrapeFromRAWG(Math.ceil(limit / 3)));
  }

  if (Object.keys(allCovers).length === 0) {
    console.log("\n❌ No se encontraron juegos");
    process.exit(1);
  }

  // Descarga y optimiza
  await downloadAndOptimize(allCovers);

  // Sube a Bana si se solicita
  if (uploadToBanaFlag) {
    await uploadToBana(allCovers);
  }

  // Genera base de datos
  await generateDatabase(allCovers);

  console.log("\n✅ ¡Scraping completado!");
  console.log(`\n📝 Próximos pasos:`);
  console.log(`   1. Revisa ${COVERS_DB_FILE}`);
  if (!uploadToBanaFlag) {
    console.log(
      `   2. Sube covers-temp/ a Bana manualmente O configura credenciales`
    );
  }
  console.log(`   3. Actualiza app.js para cargar desde Bana`);
}

main().catch(e => {
  console.error("\n❌ Error fatal:", e.message);
  process.exit(1);
});
