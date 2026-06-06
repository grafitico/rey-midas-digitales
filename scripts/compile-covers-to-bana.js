#!/usr/bin/env node
/**
 * COMPILAR COVERS EXISTENTES A BANA
 * ================================
 * Lee todos los juegos del sistema (featured-games.json, bundles, etc)
 * Extrae sus imágenes y crea índice en Bana
 *
 * Esto es MÁS RÁPIDO porque evita descargas — solo indexa lo existente
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { Client } from "basic-ftp";

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

const BANA_CONFIG = {
  host: process.env.BANA_HOST || "ftp.grafticocr.com",
  user: process.env.BANA_USER || "",
  password: process.env.BANA_PASSWORD || "",
  remotePath: process.env.BANA_REMOTE_PATH || "/public_html/covers",
  publicUrl: process.env.BANA_PUBLIC_URL || "https://reymidascr.com/covers",
};

const COVERS_DB_FILE = path.join(process.cwd(), "covers-database.json");

// ============================================================================
// CARGAR JUEGOS DEL SISTEMA
// ============================================================================
function loadLocalGames() {
  const games = [];
  const gameIds = new Set();

  // Featured games
  try {
    const featured = JSON.parse(readFileSync("featured-games.json", "utf8"));
    for (const g of featured.games || []) {
      if (g.id && !gameIds.has(g.id)) {
        games.push({
          id: `featured-${g.id}`,
          title: g.title,
          imageUrl: g.imageUrl || g.coverUrl || "",
          source: "featured",
          platform: "multi",
        });
        gameIds.add(g.id);
      }
    }
    console.log(`✅ Featured: ${featured.games?.length || 0} juegos`);
  } catch (e) {
    console.log(`⚠️  featured-games.json no encontrado`);
  }

  // PS Bundles
  try {
    const ps = JSON.parse(readFileSync("ps-bundles.json", "utf8"));
    for (const b of ps.bundles || []) {
      if (b.id && !gameIds.has(b.id)) {
        games.push({
          id: `ps-bundle-${b.id}`,
          title: b.title,
          imageUrl: b.coverUrl || "",
          source: "ps-bundle",
          platform: "PS",
        });
        gameIds.add(b.id);
      }
    }
    console.log(`✅ PS Bundles: ${ps.bundles?.length || 0} bundles`);
  } catch (e) {
    console.log(`⚠️  ps-bundles.json no encontrado`);
  }

  // Xbox Bundles
  try {
    const xbox = JSON.parse(readFileSync("xbox-bundles.json", "utf8"));
    for (const b of xbox.bundles || []) {
      if (b.id && !gameIds.has(b.id)) {
        games.push({
          id: `xbox-bundle-${b.id}`,
          title: b.title,
          imageUrl: b.coverUrl || "",
          source: "xbox-bundle",
          platform: "Xbox",
        });
        gameIds.add(b.id);
      }
    }
    console.log(`✅ Xbox Bundles: ${xbox.bundles?.length || 0} bundles`);
  } catch (e) {
    console.log(`⚠️  xbox-bundles.json no encontrado`);
  }

  // Nintendo Bundles
  try {
    const nintendo = JSON.parse(readFileSync("nintendo-bundles.json", "utf8"));
    for (const b of nintendo.bundles || []) {
      if (b.id && !gameIds.has(b.id)) {
        games.push({
          id: `nintendo-bundle-${b.id}`,
          title: b.title,
          imageUrl: b.coverUrl || "",
          source: "nintendo-bundle",
          platform: "Nintendo",
        });
        gameIds.add(b.id);
      }
    }
    console.log(`✅ Nintendo Bundles: ${nintendo.bundles?.length || 0} bundles`);
  } catch (e) {
    console.log(`⚠️  nintendo-bundles.json no encontrado`);
  }

  return games;
}

// ============================================================================
// CREAR COVERS DATABASE
// ============================================================================
function createCoversDatabase(games) {
  console.log(`\n📊 Procesando ${games.length} juegos...`);

  const covers = {};
  let withImages = 0;

  for (const game of games) {
    if (game.imageUrl && game.imageUrl.trim()) {
      // Normaliza URL (asegura https)
      let imageUrl = game.imageUrl;
      if (imageUrl.startsWith("//")) {
        imageUrl = "https:" + imageUrl;
      } else if (!imageUrl.startsWith("http")) {
        continue; // Omite URLs relativas o inválidas
      }

      covers[game.id] = {
        source: game.source,
        platform: game.platform,
        title: game.title,
        url: imageUrl,
      };
      withImages++;
    }
  }

  console.log(`✅ Con imágenes: ${withImages}/${games.length}`);

  const db = {
    generated: new Date().toISOString(),
    totalCovers: Object.keys(covers).length,
    covers,
  };

  return db;
}

// ============================================================================
// SUBIR DATABASE A BANA
// ============================================================================
async function uploadDatabaseToBana(db) {
  if (!BANA_CONFIG.user || !BANA_CONFIG.password) {
    console.log("\n⚠️  Credenciales Bana no configuradas");
    console.log("   Guardando en covers-database.json (local)");
    writeFileSync(COVERS_DB_FILE, JSON.stringify(db, null, 2));
    return;
  }

  console.log(`\n📤 Conectando a Bana...`);

  const client = new Client();

  try {
    await client.access({
      host: BANA_CONFIG.host,
      user: BANA_CONFIG.user,
      password: BANA_CONFIG.password,
    });

    console.log("✅ Conectado a Bana");

    // Crea carpeta si no existe
    try {
      await client.cd(BANA_CONFIG.remotePath);
    } catch {
      console.log(`Creando carpeta ${BANA_CONFIG.remotePath}...`);
      await client.ensureDir(BANA_CONFIG.remotePath);
    }

    // Sube JSON
    const jsonContent = JSON.stringify(db, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, "utf-8");

    await client.uploadFrom(jsonBuffer, "covers.json");
    console.log(`✅ Subido: covers.json (${jsonBuffer.length} bytes)`);

    await client.close();
  } catch (e) {
    console.error(`❌ FTP Error: ${e.message}`);
    console.log("   Guardando en covers-database.json (local)");
  }

  // Guarda copia local
  writeFileSync(COVERS_DB_FILE, JSON.stringify(db, null, 2));
  console.log(`✅ Copia local: ${COVERS_DB_FILE}`);
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("   📚 COMPILAR COVERS EXISTENTES A BANA - Rey Midas");
  console.log("═══════════════════════════════════════════════════════════\n");

  const games = loadLocalGames();
  const db = createCoversDatabase(games);
  await uploadDatabaseToBana(db);

  console.log(
    `\n✅ ¡Base de datos compilada! ${db.totalCovers} covers disponibles`
  );
  console.log(`\n📍 URL pública: ${BANA_CONFIG.publicUrl}/covers.json`);
}

main().catch(e => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
