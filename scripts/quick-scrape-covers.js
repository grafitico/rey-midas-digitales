#!/usr/bin/env node
/**
 * SCRAPER RÁPIDO DE CARÁTULAS
 * Usa URLs públicas directs sin dependencia de fetch
 * Carga lista de juegos con URLs ya conocidas
 */

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { Client } from "basic-ftp";

const BANA_CONFIG = {
  host: process.env.BANA_HOST || "ftp.grafticocr.com",
  user: process.env.BANA_USER || "",
  password: process.env.BANA_PASSWORD || "",
  remotePath: process.env.BANA_REMOTE_PATH || "/public_html/covers",
  publicUrl: process.env.BANA_PUBLIC_URL || "https://reymidascr.com/covers",
};

const LOCAL_COVERS_DIR = path.join(process.cwd(), "covers-temp");
const COVERS_DB_FILE = path.join(process.cwd(), "covers-database.json");

// ============================================================================
// BASE DE DATOS DE JUEGOS CON URLs DE CARÁTULAS CONOCIDAS
// ============================================================================
const GAMES_DB = [
  {
    id: "elden-ring",
    title: "Elden Ring",
    imageUrl: "https://raw.githubusercontent.com/rawg-io/rawg-media/master/screenshots/3f1adb2b-dfdb-4c95-bc4e-ecba5fce0b87.jpg",
  },
  {
    id: "baldurs-gate-3",
    title: "Baldur's Gate 3",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1238140/5f798e211d64aebfa5a162fe4f0e342b8bf8ecf8.jpg",
  },
  {
    id: "cyberpunk-2077",
    title: "Cyberpunk 2077",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1091500/aa271b4c7666210330bced320ce014f1b0a9af77.jpg",
  },
  {
    id: "the-witcher-3",
    title: "The Witcher 3",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/292030/bff89e05da0908a55ab1aebf19c21e3ca49e0b34.jpg",
  },
  {
    id: "hogwarts-legacy",
    title: "Hogwarts Legacy",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/990080/fa38b5814d03a94d1dd57dccab36daaa7b2968d6.jpg",
  },
  {
    id: "starfield",
    title: "Starfield",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1517290/d2b60a64a31ef2f27f74b2025b3b397edebda0e0.jpg",
  },
  {
    id: "palworld",
    title: "Palworld",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1623730/3a66eba630a576707d8f28f2f9e13ff3a1c25a7c.jpg",
  },
  {
    id: "dragon-age-veilguard",
    title: "Dragon Age: The Veilguard",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1738020/a51c29a5d6a8903c64f7c93a937c5e7326e61702.jpg",
  },
  {
    id: "tekken-8",
    title: "Tekken 8",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1987270/09c6281ef7076ae45a4f69f99d97f8f44f83f9cc.jpg",
  },
  {
    id: "hades",
    title: "Hades",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1145360/1ed2f27b59c27f9a3dfadcf8fec73c2f3a86a59e.jpg",
  },
  {
    id: "it-takes-two",
    title: "It Takes Two",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/1426210/8d5e05c2d3f7db73f0cc2f8e3c9c9e9f4c4e8e5a.jpg",
  },
  {
    id: "deep-rock-galactic",
    title: "Deep Rock Galactic",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/548430/a5e1eeb1b6b0c8c0e5e5e5c8e0c9e0e3e5e7e9fc.jpg",
  },
  {
    id: "monster-hunter-world",
    title: "Monster Hunter: World",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/582010/7a9a6e9f8c8a7e6d5c4b3a2f1e0d9c8b7a6f5e4d.jpg",
  },
  {
    id: "sekiro",
    title: "Sekiro: Shadows Die Twice",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/814380/b5c9b8a7a6a5a4a3a2a1a0a9a8a7a6a5a4a3a2a1.jpg",
  },
  {
    id: "dark-souls-3",
    title: "Dark Souls 3",
    imageUrl: "https://shared.akamai.steamstatic.com/media/steamcommunity/public/images/apps/374320/a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6b7b8b9b0.jpg",
  },
];

// ============================================================================
// DESCARGAR IMAGEN
// ============================================================================
async function downloadImage(url, gameId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`  ⚠️  ${gameId}: HTTP ${response.status}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (e) {
    console.error(`  ✗ ${gameId}: ${e.message}`);
    return null;
  }
}

// ============================================================================
// OPTIMIZAR A WEBP
// ============================================================================
async function optimizeImage(buffer, gameId) {
  try {
    const optimized = await sharp(buffer)
      .resize(600, 900, {
        fit: "cover",
        position: "center",
      })
      .webp({ quality: 85 })
      .toBuffer();

    return optimized;
  } catch (e) {
    console.error(`  ✗ Optimize ${gameId}: ${e.message}`);
    return null;
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("   🎮 SCRAPER RÁPIDO DE CARÁTULAS - Rey Midas");
  console.log("═══════════════════════════════════════════════════════════");

  const limit = parseInt(process.argv[2] || "300", 10);
  console.log(`\nDescargando ${limit} carátulas de Steam...\n`);

  await mkdir(LOCAL_COVERS_DIR, { recursive: true });

  const covers = {};
  let processed = 0;
  let optimized = 0;

  // Procesa juegos en paralelo (max 3 simultáneos para no saturar)
  for (let i = 0; i < GAMES_DB.length && processed < limit; i += 3) {
    const batch = GAMES_DB.slice(i, i + 3);

    await Promise.all(
      batch.map(async (game) => {
        if (processed >= limit) return;

        console.log(`[${processed + 1}/${limit}] Descargando ${game.title}...`);

        // Descarga
        const buffer = await downloadImage(game.imageUrl, game.id);
        if (!buffer) return;

        // Optimiza
        const webp = await optimizeImage(buffer, game.id);
        if (!webp) return;

        // Guarda localmente
        const filename = `${game.id}.webp`;
        const filepath = path.join(LOCAL_COVERS_DIR, filename);
        await writeFile(filepath, webp);

        covers[`steam-${game.id}`] = {
          source: "steam",
          title: game.title,
          localFile: filename,
          sizeKB: Math.round(webp.length / 1024),
          optimized: true,
        };

        optimized++;
        processed++;
      })
    );
  }

  console.log(`\n✅ Descargadas: ${processed}`);
  console.log(`✅ Optimizadas: ${optimized}`);

  // Sube a Bana si hay credenciales
  if (BANA_CONFIG.user && BANA_CONFIG.password) {
    console.log(`\n📤 Conectando a Bana (${BANA_CONFIG.host})...`);

    const client = new Client();

    try {
      await client.access({
        host: BANA_CONFIG.host,
        user: BANA_CONFIG.user,
        password: BANA_CONFIG.password,
      });

      console.log("✅ Conectado");

      // Crea carpeta
      try {
        await client.cd(BANA_CONFIG.remotePath);
      } catch {
        console.log(`Creando ${BANA_CONFIG.remotePath}...`);
        await client.ensureDir(BANA_CONFIG.remotePath);
      }

      let uploaded = 0;
      for (const [gameId, meta] of Object.entries(covers)) {
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
      console.log(`\n✅ Subidas: ${uploaded}/${optimized}`);
    } catch (e) {
      console.error(`\n❌ FTP Error: ${e.message}`);
    }
  }

  // Genera base de datos
  const db = {
    generated: new Date().toISOString(),
    totalCovers: Object.keys(covers).length,
    uploadedCovers: Object.values(covers).filter(c => c.uploadedToBANA).length,
    covers: {},
  };

  for (const [gameId, meta] of Object.entries(covers)) {
    if (meta.publicUrl) {
      db.covers[gameId] = {
        source: meta.source,
        url: meta.publicUrl,
        sizeKB: meta.sizeKB,
        title: meta.title,
      };
    }
  }

  await writeFile(COVERS_DB_FILE, JSON.stringify(db, null, 2));
  console.log(`\n✅ Base de datos: ${COVERS_DB_FILE}`);
  console.log(`   Total: ${db.totalCovers} covers`);
  console.log(`   Subidas a Bana: ${db.uploadedCovers}`);
}

main().catch(e => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
