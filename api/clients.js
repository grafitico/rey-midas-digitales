// Gestión de clientes (solo admins).
// POST /api/clients con { action: "create" | "find", ... }

import { sb, hashPassword, requireAdmin, handleError, readJson, checkConfig } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    await requireAdmin(req);
    const body = await readJson(req);
    if (body.action === "create") return await create(req, res, body);
    if (body.action === "find") return await find(req, res, body);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

async function create(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = body.full_name ? String(body.full_name).trim() : null;
  if (!email || password.length < 6) {
    return res.status(400).json({ error: "Email y contraseña (6+ caracteres) son requeridos" });
  }
  const existing = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing.length) {
    return res.status(400).json({ error: "Ya existe un cliente con ese email" });
  }
  const inserted = await sb(`app_users`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      email,
      password_hash: hashPassword(password),
      is_admin: false,
      full_name: fullName,
    }),
  });
  res.status(200).json({ id: inserted[0].id, email: inserted[0].email });
}

async function find(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email requerido" });
  const users = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=id,email,full_name`);
  res.status(200).json({ user: users[0] || null });
}
