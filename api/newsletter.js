// Newsletter: suscripción pública + lista de suscriptores para admin.
// POST /api/newsletter con { action: "subscribe" | "list", ... }

import crypto from "crypto";
import { sb, requireAdmin, handleError, readJson, checkConfig, checkRateLimit } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    const body = await readJson(req);
    if (body.action === "subscribe") return await subscribe(req, res, body);
    if (body.action === "list") return await list(req, res);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

async function subscribe(req, res, body) {
  // 5 suscripciones por IP cada hora (evita enumeración de códigos)
  checkRateLimit(req, { prefix: "newsletter", max: 5, windowMs: 60 * 60 * 1000 });
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

async function list(req, res) {
  await requireAdmin(req);
  const data = await sb(`newsletter_subscribers?select=*&order=subscribed_at.desc&limit=500`);
  res.status(200).json({ subscribers: data });
}

function generateDiscountCode(email) {
  const base = email.replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 4);
  // 5 bytes → 8 chars base32-like (solo A-Z0-9), ~47 bits de entropía real
  const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin O/0/I/L para evitar confusión visual
  const rand = Array.from(crypto.randomBytes(5))
    .map(b => CHARS[b % CHARS.length])
    .join("");
  return `BIENVENIDA-${base}${rand}`;
}
