// Valida que un código de descuento exista en la base y no haya sido usado.
// POST /api/validate-discount { code: "BIENVENIDA-XXXX" }
// Responde { valid: true } o { valid: false }.
// No requiere autenticación: es llamado desde el carrito público.

import { sb, handleError, readJson, checkConfig, checkRateLimit } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    // 20 validaciones por IP cada hora (evita enumeración por fuerza bruta)
    checkRateLimit(req, { prefix: "validate-discount", max: 20, windowMs: 60 * 60 * 1000 });
    const body = await readJson(req);
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) return res.status(200).json({ valid: false });

    const rows = await sb(
      `newsletter_subscribers?discount_code=eq.${encodeURIComponent(code)}&select=discount_code,used`
    );
    const valid = rows.length > 0 && !rows[0].used;
    res.status(200).json({ valid });
  } catch (err) {
    handleError(res, err);
  }
}
