// Newsletter: suscripción pública + lista de suscriptores para admin.
// POST /api/newsletter con { action: "subscribe" | "list", ... }

import { sb, requireAdmin, handleError, readJson, checkConfig, rateLimit } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    const body = await readJson(req);
    if (body.action === "subscribe") return await subscribe(req, res, body);
    if (body.action === "validate-code") return await validateCode(req, res, body);
    if (body.action === "list") return await list(req, res);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

async function subscribe(req, res, body) {
  // Anti-spam: máx. 5 suscripciones por IP cada 10 minutos.
  const ok = await rateLimit(req, { action: "newsletter", limit: 5, windowSec: 600 });
  if (!ok) {
    return res.status(429).json({ error: "Demasiadas solicitudes. Probá de nuevo en unos minutos." });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const source = String(body.source || "unknown").slice(0, 30);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Email inválido" });
  }

  // Si ya está suscrito, devolvemos su código existente (idempotente)
  const existing = await sb(`newsletter_subscribers?email=eq.${encodeURIComponent(email)}&select=*`);
  if (existing.length) {
    return res.status(200).json({
      ok: true,
      code: existing[0].discount_code,
      alreadySubscribed: true,
    });
  }

  // Generar código único corto basado en el email (mismo email = mismo código siempre)
  const code = generateDiscountCode(email);
  const inserted = await sb(`newsletter_subscribers`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      email,
      source,
      discount_code: code,
    }),
  });
  res.status(200).json({ ok: true, code: inserted[0].discount_code });
}

// Valida un código de descuento contra los códigos reales emitidos a
// suscriptores. Evita que cualquier texto al azar active el 10% en el
// carrito. Devuelve { valid, discountPct }.
async function validateCode(req, res, body) {
  const ok = await rateLimit(req, { action: "validate-code", limit: 20, windowSec: 300 });
  if (!ok) {
    return res.status(429).json({ error: "Demasiados intentos. Esperá unos minutos." });
  }
  const code = String(body.code || "").trim().toUpperCase().slice(0, 40);
  if (!code) return res.status(400).json({ valid: false, error: "Falta el código" });
  const rows = await sb(`newsletter_subscribers?discount_code=eq.${encodeURIComponent(code)}&select=discount_code&limit=1`);
  if (rows.length) {
    return res.status(200).json({ valid: true, discountPct: 10 });
  }
  return res.status(200).json({ valid: false });
}

async function list(req, res) {
  await requireAdmin(req);
  const data = await sb(`newsletter_subscribers?select=*&order=subscribed_at.desc&limit=500`);
  res.status(200).json({ subscribers: data });
}

function generateDiscountCode(email) {
  // Código consistente y leíble. No usamos hashes complejos porque queremos
  // que sea fácil de leer/escribir si el cliente lo pasa por WhatsApp.
  const base = email.replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return `BIENVENIDA-${base}${rand}`;
}
