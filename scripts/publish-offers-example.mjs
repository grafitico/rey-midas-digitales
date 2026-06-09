#!/usr/bin/env node
/**
 * Script: Ejemplo de cómo publicar ofertas desde una app externa
 *
 * Este script muestra el flujo completo:
 * 1. Obtener juegos/precios de una fuente (PSN API, RSS, etc)
 * 2. Convertir precios USD → CRC usando la API
 * 3. Crear ofertas en tu sistema
 *
 * Para usar en producción:
 * - Reemplaza GAMES con datos reales de PSN/Xbox
 * - Implementa la lógica de crear ofertas en tu BD
 * - Añade autenticación si es necesario
 */

import { principalCRC, secundariaCRC } from '../api/pricing-utils.mjs';

// Juegos en rebaja (como los que obtendrías de PSN/Xbox en tiempo real)
const DISCOUNTED_GAMES = [
  {
    id: "psn_123",
    title: "Baldur's Gate 3",
    platform: "PS5",
    originalPriceUSD: 59.99,
    currentPriceUSD: 29.99,  // 50% off
    storeUrl: "https://store.playstation.com/...",
    imageUrl: "https://...",
  },
  {
    id: "psn_456",
    title: "Final Fantasy VII Rebirth",
    platform: "PS5",
    originalPriceUSD: 69.99,
    currentPriceUSD: 49.99,  // 29% off
    storeUrl: "https://store.playstation.com/...",
    imageUrl: "https://...",
  },
];

async function convertGamePrices(game) {
  const principal = principalCRC(game.currentPriceUSD, game.platform);
  const principalOriginal = principalCRC(game.originalPriceUSD, game.platform);
  const secundaria = secundariaCRC(game.currentPriceUSD, game.platform);
  const secondariaOriginal = secundariaCRC(game.originalPriceUSD, game.platform);

  const discount = Math.round(
    ((game.originalPriceUSD - game.currentPriceUSD) / game.originalPriceUSD) * 100
  );

  return {
    ...game,
    priceCRC_principal: principal,
    priceCRC_principal_original: principalOriginal,
    priceCRC_secundaria: secundaria,
    priceCRC_secundaria_original: secondariaOriginal,
    discount,
    savings_principal: principalOriginal - principal,
    savings_secundaria: secondariaOriginal - secundaria,
  };
}

async function publishOffer(game) {
  // Aquí harías una llamada a tu API para guardar la oferta
  // Ejemplo: POST /api/admin/offers
  /*
  const res = await fetch("https://reymidascr.com/api/admin/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: game.title,
      platform: game.platform,
      priceUSD: game.currentPriceUSD,
      priceCRC_principal: game.priceCRC_principal,
      priceCRC_secundaria: game.priceCRC_secundaria,
      originalPriceCRC_principal: game.priceCRC_principal_original,
      discount: game.discount,
      imageUrl: game.imageUrl,
      storeUrl: game.storeUrl,
    })
  });
  return res.json();
  */

  // Por ahora, simulamos éxito
  return {
    success: true,
    message: `Oferta creada: ${game.title}`,
    offerId: `offer_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  };
}

function formatCRC(n) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    minimumFractionDigits: 0,
  }).format(n);
}

async function main() {
  console.log("🎮 PUBLICADOR DE OFERTAS\n");
  console.log("=".repeat(80));

  for (const game of DISCOUNTED_GAMES) {
    console.log(`\n📱 ${game.title} (${game.platform})`);
    console.log("-".repeat(80));

    // Paso 1: Convertir precios
    const converted = await convertGamePrices(game);

    console.log(`Precio Original USD: ${formatCRC(game.originalPriceUSD * 530)}`);
    console.log(`Precio Actual USD:   ${formatCRC(game.currentPriceUSD * 530)}`);
    console.log(`Descuento: ${converted.discount}%\n`);

    console.log("💳 OFERTA EN COSTA RICA:");
    console.log(`  Principal:  ${formatCRC(converted.priceCRC_principal_original)} → ${formatCRC(converted.priceCRC_principal)}`);
    console.log(`             Ahorrás ${formatCRC(converted.savings_principal)}`);
    console.log(`  Secundaria: ${formatCRC(converted.priceCRC_secundaria_original)} → ${formatCRC(converted.priceCRC_secundaria)}`);
    console.log(`             Ahorrás ${formatCRC(converted.savings_secundaria)}`);

    // Paso 2: Publicar oferta
    console.log("\n⏳ Publicando oferta...");
    const result = await publishOffer(converted);

    if (result.success) {
      console.log(`✅ ${result.message}`);
      console.log(`   ID: ${result.offerId}`);
    } else {
      console.log(`❌ Error: ${result.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Proceso completado");
  console.log("");
  console.log("📝 Próximos pasos:");
  console.log("  1. Implementar autenticación en /api/admin/offers");
  console.log("  2. Conectar con tu BD (crear tabla de ofertas)");
  console.log("  3. Validar datos antes de guardar");
  console.log("  4. Agregar notificaciones (email, WhatsApp)");
  console.log("  5. Automatizar con webhooks de PSN/Xbox");
}

main().catch(console.error);
