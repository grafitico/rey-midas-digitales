// Gestión de clientes (solo admins).
// POST /api/clients con { action: "create" | "find", ... }

import { sb, hashPassword, requireAdmin, handleError, readJson, checkConfig } from "./_lib.js";

// Columnas seguras del cliente que exponemos al panel (nunca password_hash).
// phone y console las agrega migrations/add_client_fields.sql.
const CLIENT_COLS = "id,email,full_name,customer_number,phone,console";
const CLIENT_COLS_BASE = "id,email,full_name,customer_number";

// Selecciona clientes con phone/console; si esas columnas todavía no existen
// (migración sin correr) cae a las columnas base para no romper el panel.
export async function selectClients(filterQs) {
  try {
    return await sb(`${filterQs}&select=${CLIENT_COLS}`);
  } catch (err) {
    if (/phone|console|does not exist/i.test(err.message || "")) {
      return await sb(`${filterQs}&select=${CLIENT_COLS_BASE}`);
    }
    throw err;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    await requireAdmin(req);
    const body = await readJson(req);
    if (body.action === "create") return await create(req, res, body);
    if (body.action === "find") return await find(req, res, body);
    if (body.action === "list") return await list(req, res);
    if (body.action === "update") return await update(req, res, body);
    if (body.action === "reset-password") return await resetPassword(req, res, body);
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
  const insert = {
    email,
    password_hash: hashPassword(password),
    is_admin: false,
    full_name: fullName,
  };
  // Columnas nuevas (add_client_fields.sql): solo viajan cuando vienen con valor,
  // así crear clientes no falla si la migración todavía no se corrió.
  const phone = body.phone ? String(body.phone).trim() : null;
  const consoleVal = body.console ? String(body.console).trim() : null;
  if (phone) insert.phone = phone;
  if (consoleVal) insert.console = consoleVal;
  const inserted = await sb(`app_users`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(insert),
  });
  res.status(200).json({ id: inserted[0].id, email: inserted[0].email, customer_number: inserted[0].customer_number });
}

async function find(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email requerido" });
  const users = await selectClients(`app_users?email=eq.${encodeURIComponent(email)}`);
  res.status(200).json({ user: users[0] || null });
}

async function list(req, res) {
  const clients = await selectClients(`app_users?is_admin=eq.false&order=customer_number.asc`);
  res.status(200).json({ clients });
}

async function update(req, res, body) {
  const id = String(body.id || "");
  if (!id) return res.status(400).json({ error: "ID requerido" });
  const patch = {};
  if (body.full_name !== undefined) patch.full_name = body.full_name || null;
  if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone).trim() : null;
  if (body.console !== undefined) patch.console = body.console ? String(body.console).trim() : null;
  if (body.email) {
    const email = String(body.email).trim().toLowerCase();
    const existing = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing.length && existing[0].id !== id) {
      return res.status(400).json({ error: "Ese email ya está en uso por otro cliente" });
    }
    patch.email = email;
  }
  await sb(`app_users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  res.status(200).json({ ok: true });
}

async function resetPassword(req, res, body) {
  const id = String(body.id || "");
  const password = String(body.password || "");
  if (!id || password.length < 6) {
    return res.status(400).json({ error: "ID y contraseña (mínimo 6 caracteres) son requeridos" });
  }
  await sb(`app_users?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ password_hash: hashPassword(password) }),
  });
  res.status(200).json({ ok: true });
}
