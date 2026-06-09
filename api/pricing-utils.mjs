// Utilidades de conversión de precios USD → CRC
// Usado por: app.js, middleware.js, api/price-converter.js
// Fuente única de verdad para conversiones

export const CONFIG = {
  exchangeRate: 530,
  principalMarkup: 0.75,
  secundariaMarkup: 0.35,
  table: [
    [10, 4000,  2500],
    [20, 6000,  3000],
    [30, 11000, 5500],
    [40, 17000, 7000],
    [50, 21000, 9000],
    [60, 26000, 13000],
    [70, 28500, 15000],
    [80, 36000, 14000],
  ],
};

export function interpolateCRC(usd, colIdx) {
  if (!usd || usd <= 0) return 0;
  const tbl = CONFIG.table;
  const col = (row) => row[colIdx + 1];

  // Por debajo del primer punto
  if (usd <= tbl[0][0]) {
    const t = (usd - tbl[0][0]) / (tbl[1][0] - tbl[0][0]);
    return Math.max(0, Math.round(col(tbl[0]) + t * (col(tbl[1]) - col(tbl[0]))));
  }

  // Por encima del último punto
  const last = tbl.length - 1;
  if (usd >= tbl[last][0]) {
    const t = (usd - tbl[last - 1][0]) / (tbl[last][0] - tbl[last - 1][0]);
    return Math.round(col(tbl[last - 1]) + t * (col(tbl[last]) - col(tbl[last - 1])));
  }

  // En el medio: busca el intervalo
  for (let i = 0; i < tbl.length - 1; i++) {
    if (usd >= tbl[i][0] && usd <= tbl[i + 1][0]) {
      const t = (usd - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
      return Math.round(col(tbl[i]) + t * (col(tbl[i + 1]) - col(tbl[i])));
    }
  }
  return 0;
}

export function principalCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 0);
  return Math.round(usd * CONFIG.exchangeRate * CONFIG.principalMarkup);
}

export function secundariaCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 1);
  return Math.round(usd * CONFIG.exchangeRate * CONFIG.secundariaMarkup);
}

export function convertPrice(priceUSD, platform = "") {
  return {
    priceUSD,
    platform,
    principal: principalCRC(priceUSD, platform),
    secundaria: secundariaCRC(priceUSD, platform),
  };
}
