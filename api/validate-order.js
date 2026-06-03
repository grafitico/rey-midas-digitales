// Valida que los precios de un pedido coincidan con los precios reales del catálogo.
// POST /api/validate-order { items: [{ id, modality, priceCRC }] }
// Devuelve { ok, items } con los precios recalculados del servidor,
// o { ok: false, error } si algún precio difiere más del margen permitido.

import { readFileSync } from "fs";
import { join } from "path";
import { handleError, readJson } from "./_lib.js";

// Misma tabla que CONFIG.pricing en app.js — fuente de verdad del servidor
const PRICING = {
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

// Tolerancia: 5% de diferencia aceptable (para precios en vivo de PSN que
// pueden haber cambiado entre que el cliente cargó la página y hace checkout)
const PRICE_TOLERANCE = 0.05;

function interpolateCRC(usd, colIdx) {
  const tbl = PRICING.table;
  if (!usd || usd <= 0) return 0;
  const col = (row) => row[colIdx + 1];
  if (usd <= tbl[0][0]) {
    const t = (usd - tbl[0][0]) / (tbl[1][0] - tbl[0][0]);
    return Math.max(0, Math.round(col(tbl[0]) + t * (col(tbl[1]) - col(tbl[0]))));
  }
  const last = tbl.length - 1;
  if (usd >= tbl[last][0]) {
    const t = (usd - tbl[last - 1][0]) / (tbl[last][0] - tbl[last - 1][0]);
    return Math.round(col(tbl[last - 1]) + t * (col(tbl[last]) - col(tbl[last - 1])));
  }
  for (let i = 0; i < tbl.length - 1; i++) {
    if (usd >= tbl[i][0] && usd <= tbl[i + 1][0]) {
      const t = (usd - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
      return Math.round(col(tbl[i]) + t * (col(tbl[i + 1]) - col(tbl[i])));
    }
  }
  return 0;
}

function calcPrice(priceUSD, platform, modality) {
  const isPsXbox = /PS|Xbox/i.test(platform);
  if (modality === "principal") {
    return isPsXbox
      ? interpolateCRC(priceUSD, 0)
      : Math.round(priceUSD * PRICING.exchangeRate * PRICING.principalMarkup);
  }
  return isPsXbox
    ? interpolateCRC(priceUSD, 1)
    : Math.round(priceUSD * PRICING.exchangeRate * PRICING.secundariaMarkup);
}

function loadJson(filename) {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), filename), "utf8"));
  } catch { return {}; }
}

// Construye un mapa id→game buscando en todas las fuentes del catálogo
function buildCatalog() {
  const catalog = new Map();

  // Featured games (precio en USD → se calcula)
  const featured = loadJson("featured-games.json");
  for (const g of (featured.games || [])) {
    if (g.id) catalog.set(g.id, { type: "featured", ...g });
  }

  // Bundles de PS y Xbox (precio fijo en CRC)
  for (const file of ["ps-bundles.json", "xbox-bundles.json"]) {
    const data = loadJson(file);
    for (const b of (data.bundles || [])) {
      if (b.id) catalog.set(String(b.id), { type: "bundle", ...b });
    }
  }

  // Bundles de Nintendo (precio fijo en CRC)
  const nintendo = loadJson("nintendo-bundles.json");
  for (const b of (nintendo.bundles || [])) {
    if (b.id) catalog.set(String(b.id), { type: "bundle", ...b });
  }

  return catalog;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ error: "El pedido está vacío" });

    const catalog = buildCatalog();
    const validated = [];

    for (const item of items) {
      const id = String(item.id || "");
      const modality = String(item.modality || "");
      const submittedPrice = Number(item.priceCRC) || 0;

      const entry = catalog.get(id);
      if (!entry) {
        // Juego no encontrado en el catálogo local (ej: precio en vivo de PSN).
        // Lo aceptamos con el precio enviado por el cliente — el admin
        // confirma manualmente antes de procesar el pago.
        validated.push({ ...item, _serverValidated: false });
        continue;
      }

      let expectedPrice;
      if (entry.type === "bundle") {
        // Bundles tienen precio fijo en CRC — no se negocia
        expectedPrice = Number(entry.priceCRC) || 0;
      } else {
        // Featured games: recalcular desde priceUSD
        expectedPrice = calcPrice(Number(entry.priceUSD) || 0, entry.platform || "", modality);
      }

      if (expectedPrice > 0) {
        const diff = Math.abs(submittedPrice - expectedPrice) / expectedPrice;
        if (diff > PRICE_TOLERANCE) {
          return res.status(400).json({
            ok: false,
            error: `Precio incorrecto para "${entry.title || id}". ` +
                   `Esperado: ₡${expectedPrice.toLocaleString("es-CR")}, ` +
                   `recibido: ₡${submittedPrice.toLocaleString("es-CR")}.`,
          });
        }
      }

      validated.push({ ...item, priceCRC: expectedPrice || submittedPrice, _serverValidated: true });
    }

    const subtotal = validated.reduce((s, i) => s + i.priceCRC, 0);
    res.status(200).json({ ok: true, items: validated, subtotal });
  } catch (err) {
    handleError(res, err);
  }
}
