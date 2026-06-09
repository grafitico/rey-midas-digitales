#!/usr/bin/env node
/**
 * Script: Convertir precios en lote desde un CSV o JSON
 *
 * Uso:
 *   node scripts/batch-convert-offers.mjs
 *
 * Entrada: Un JSON con ofertas que tienen priceUSD
 * Salida: JSON enriquecido con priceCRC_principal y priceCRC_secundaria
 *
 * Ejemplo de entrada:
 *   [
 *     { id: 1, title: "Game 1", priceUSD: 19.99, platform: "PS5" },
 *     { id: 2, title: "Game 2", priceUSD: 29.99, platform: "Xbox" }
 *   ]
 *
 * Ejemplo de salida:
 *   [
 *     {
 *       id: 1,
 *       title: "Game 1",
 *       priceUSD: 19.99,
 *       platform: "PS5",
 *       priceCRC_principal: 9500,
 *       priceCRC_secundaria: 5800
 *     },
 *     ...
 *   ]
 */

import { principalCRC, secundariaCRC } from '../api/pricing-utils.mjs';

// Datos de ejemplo: ofertas que quieres publicar
const OFFERS = [
  {
    id: "offer_001",
    title: "Baldur's Gate 3",
    priceUSD: 49.99,
    platform: "PS5",
    originalPriceUSD: 59.99,
    discount: 17
  },
  {
    id: "offer_002",
    title: "Elden Ring",
    priceUSD: 39.99,
    platform: "PS4",
    originalPriceUSD: 59.99,
    discount: 33
  },
  {
    id: "offer_003",
    title: "Starfield",
    priceUSD: 59.99,
    platform: "Xbox",
    originalPriceUSD: 69.99,
    discount: 14
  },
  {
    id: "offer_004",
    title: "Super Mario Bros Wonder",
    priceUSD: 59.99,
    platform: "Switch",
    originalPriceUSD: 69.99,
    discount: 14
  }
];

function convertOffers(offers) {
  return offers.map(offer => ({
    ...offer,
    priceCRC_principal: principalCRC(offer.priceUSD, offer.platform),
    priceCRC_secundaria: secundariaCRC(offer.priceUSD, offer.platform),
    // Precio original en CRC para comparativas
    ...(offer.originalPriceUSD && {
      originalPriceCRC_principal: principalCRC(offer.originalPriceUSD, offer.platform)
    })
  }));
}

function formatCRC(n) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    minimumFractionDigits: 0
  }).format(n);
}

function main() {
  console.log("🔄 Convirtiendo ofertas...\n");

  const converted = convertOffers(OFFERS);

  // Mostrar tabla
  console.log("┌─────┬────────────────────────┬────────┬────────────┬────────────┐");
  console.log("│ ID  │ Juego                  │ Plat.  │ Principal  │ Secundaria │");
  console.log("├─────┼────────────────────────┼────────┼────────────┼────────────┤");

  for (const offer of converted) {
    const id = offer.id.replace("offer_", "");
    const title = offer.title.substring(0, 22).padEnd(22);
    const plat = (offer.platform || "").padEnd(6);
    const principal = formatCRC(offer.priceCRC_principal).padStart(10);
    const secundaria = formatCRC(offer.priceCRC_secundaria).padStart(10);

    console.log(`│ ${id} │ ${title} │ ${plat} │ ${principal} │ ${secundaria} │`);
  }

  console.log("└─────┴────────────────────────┴────────┴────────────┴────────────┘");
  console.log("");

  // Mostrar JSON de salida
  console.log("📋 JSON convertido (para guardar o subir a tu app):\n");
  console.log(JSON.stringify(converted, null, 2));

  // Estadísticas
  console.log("\n📊 Estadísticas:");
  const totalPrincipal = converted.reduce((s, o) => s + o.priceCRC_principal, 0);
  const totalSecundaria = converted.reduce((s, o) => s + o.priceCRC_secundaria, 0);
  const avgPrincipal = Math.round(totalPrincipal / converted.length);

  console.log(`   Ofertas convertidas: ${converted.length}`);
  console.log(`   Precio principal promedio: ${formatCRC(avgPrincipal)}`);
  console.log(`   Total (principal): ${formatCRC(totalPrincipal)}`);
  console.log(`   Total (secundaria): ${formatCRC(totalSecundaria)}`);
  console.log("");

  // Guardar a archivo
  const fs = await import('fs').then(m => m.promises);
  const output = "offers-converted.json";
  await fs.writeFile(output, JSON.stringify(converted, null, 2));
  console.log(`✅ Guardado en: ${output}`);
}

main().catch(console.error);
