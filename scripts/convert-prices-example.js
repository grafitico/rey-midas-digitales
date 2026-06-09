#!/usr/bin/env node
/**
 * Ejemplo: Convertir precios USD → CRC usando la API
 *
 * Uso:
 *   node scripts/convert-prices-example.js
 */

const API_URL = "https://reymidascr.com/api/price-converter";

// Juegos de ejemplo (como los que podrías traer de PlayStation Store / Xbox)
const GAMES = [
  { title: "Baldur's Gate 3", priceUSD: 59.99, platform: "PS5" },
  { title: "Final Fantasy VII Rebirth", priceUSD: 69.99, platform: "PS5" },
  { title: "Elden Ring", priceUSD: 59.99, platform: "PS4" },
  { title: "Forza Horizon 5", priceUSD: 69.99, platform: "Xbox" },
  { title: "Game Pass (1 mes)", priceUSD: 16.99, platform: "Xbox" },
  { title: "The Legend of Zelda: Tears of the Kingdom", priceUSD: 69.99, platform: "Switch" },
];

async function convertPrice(priceUSD, platform = "PS5") {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceUSD, platform }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.error(`❌ Error convertiendo $${priceUSD}:`, error.message);
    return null;
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("📊 CONVERTIDOR DE PRECIOS — reymidascr.com");
  console.log("=".repeat(80));
  console.log("");

  for (const game of GAMES) {
    const converted = await convertPrice(game.priceUSD, game.platform);

    if (converted) {
      const savings = converted.platform.includes("PS")
        ? `(vs PSN: -${Math.round((1 - converted.principal / (game.priceUSD * 530)) * 100)}%)`
        : "";

      console.log(`🎮 ${game.title.padEnd(45)} [${game.platform}]`);
      console.log(`   Precio USD:        $${game.priceUSD}`);
      console.log(`   💳 Principal:      ${converted.principal.toLocaleString("es-CR")} CRC  (acceso completo)`);
      console.log(`   🎟️  Secundaria:     ${converted.secundaria.toLocaleString("es-CR")} CRC  (game share) ${savings}`);
      console.log(`   📈 Tipo de cambio: ${converted.exchangeRate} CRC por USD`);
      console.log("");
    }
  }

  console.log("=".repeat(80));
  console.log("✅ Conversión completada");
  console.log("");
  console.log("💡 Tip: Importa las funciones en tu app:");
  console.log("   import { principalCRC, secundariaCRC } from './api/pricing-utils.mjs'");
  console.log("=".repeat(80));
}

main().catch(console.error);
