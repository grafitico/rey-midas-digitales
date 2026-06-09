// API centralizada para convertir precios USD → CRC
// Endpoint: POST /api/price-converter
// Uso: { priceUSD: 19.99, platform: "PS5" }
// Respuesta: { principal: 9500, secundaria: 5800, exchangeRate: 530, source: "rey-midas-digitales" }

// TABLA DE PRECIOS: interpolación lineal para PS/Xbox
// Formato: [usd, principal_crc, secundaria_crc]
// Principal: acceso completo + juego offline
// Secundaria: más económico, necesita conexión a internet
const PRICING_TABLE = [
  [10, 4000,  2500],
  [20, 6000,  3000],
  [30, 11000, 5500],
  [40, 17000, 7000],
  [50, 21000, 9000],
  [60, 26000, 13000],
  [70, 28500, 15000],
  [80, 36000, 14000],
];

const EXCHANGE_RATE = 530;
const PRINCIPAL_MARKUP = 0.75;
const SECUNDARIA_MARKUP = 0.35;

// Interpola linealmente entre dos puntos de la tabla
function interpolateCRC(usd, colIdx) {
  if (!usd || usd <= 0) return 0;

  const col = (row) => row[colIdx + 1];

  // Por debajo del primer punto
  if (usd <= PRICING_TABLE[0][0]) {
    const t = (usd - PRICING_TABLE[0][0]) / (PRICING_TABLE[1][0] - PRICING_TABLE[0][0]);
    return Math.max(0, Math.round(col(PRICING_TABLE[0]) + t * (col(PRICING_TABLE[1]) - col(PRICING_TABLE[0]))));
  }

  // Por encima del último punto
  const last = PRICING_TABLE.length - 1;
  if (usd >= PRICING_TABLE[last][0]) {
    const t = (usd - PRICING_TABLE[last - 1][0]) / (PRICING_TABLE[last][0] - PRICING_TABLE[last - 1][0]);
    return Math.round(col(PRICING_TABLE[last - 1]) + t * (col(PRICING_TABLE[last]) - col(PRICING_TABLE[last - 1])));
  }

  // En el medio: busca el intervalo
  for (let i = 0; i < PRICING_TABLE.length - 1; i++) {
    if (usd >= PRICING_TABLE[i][0] && usd <= PRICING_TABLE[i + 1][0]) {
      const t = (usd - PRICING_TABLE[i][0]) / (PRICING_TABLE[i + 1][0] - PRICING_TABLE[i][0]);
      return Math.round(col(PRICING_TABLE[i]) + t * (col(PRICING_TABLE[i + 1]) - col(PRICING_TABLE[i])));
    }
  }

  return 0;
}

// Calcula precio principal en CRC
function convertPrincipalCRC(usd, platform = "") {
  // PS/Xbox usan la tabla de interpolación; Switch y otras usan markup simple
  if (/PS|Xbox/i.test(platform)) {
    return interpolateCRC(usd, 0);
  }
  return Math.round(usd * EXCHANGE_RATE * PRINCIPAL_MARKUP);
}

// Calcula precio secundaria en CRC
function convertSecundariaCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) {
    return interpolateCRC(usd, 1);
  }
  return Math.round(usd * EXCHANGE_RATE * SECUNDARIA_MARKUP);
}

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido. Usa POST." });
  }

  const { priceUSD, platform } = req.body || {};

  // Validar entrada
  const usd = Number(priceUSD);
  if (isNaN(usd) || usd < 0) {
    return res.status(400).json({
      error: "priceUSD inválido. Debe ser un número >= 0.",
      example: { priceUSD: 19.99, platform: "PS5" },
    });
  }

  try {
    const principal = convertPrincipalCRC(usd, platform);
    const secundaria = convertSecundariaCRC(usd, platform);

    return res.status(200).json({
      priceUSD: usd,
      platform: platform || "PS5/PS4",
      principal,
      secundaria,
      exchangeRate: EXCHANGE_RATE,
      pricingTable: PRICING_TABLE,
      source: "rey-midas-digitales",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error en price-converter:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

// Exportar las funciones para uso interno (en scripts, middleware, etc)
export { convertPrincipalCRC, convertSecundariaCRC, interpolateCRC, PRICING_TABLE, EXCHANGE_RATE };
