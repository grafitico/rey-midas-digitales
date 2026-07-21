// Newsletter: suscripción pública + lista de suscriptores para admin.
// POST /api/newsletter con { action: "subscribe" | "list", ... }
// Nota: el código de descuento del 10% fue reemplazado por el programa de
// lealtad "Cofre de Oro del Rey Midas" (ver cofre-games.json y /cofre).
// La columna discount_code sigue en la tabla por los suscriptores viejos,
// pero ya no se genera ni se devuelve.

import { sb, requireAdmin, handleError, readJson, checkConfig } from "./_lib.js";

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
  const email = String(body.email || "").trim().toLowerCase();
  const source = String(body.source || "unknown").slice(0, 30);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Email inválido" });
  }

  // Si ya está suscrito, respondemos ok igual (idempotente)
  const existing = await sb(`newsletter_subscribers?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing.length) {
    return res.status(200).json({ ok: true, alreadySubscribed: true });
  }

  await sb(`newsletter_subscribers`, {
    method: "POST",
    body: JSON.stringify({ email, source }),
  });
  res.status(200).json({ ok: true });
}

async function list(req, res) {
  await requireAdmin(req);
  const data = await sb(`newsletter_subscribers?select=*&order=subscribed_at.desc&limit=500`);
  res.status(200).json({ subscribers: data });
}
