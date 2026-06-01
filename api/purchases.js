// CRUD de compras. Cliente ve las propias, admin ve/crea/borra todas.
// POST /api/purchases con { action: "mine" | "list-all" | "create" | "delete", ... }

import { sb, requireAuth, requireAdmin, handleError, readJson, checkConfig } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    const body = await readJson(req);
    if (body.action === "mine") return await mine(req, res);
    if (body.action === "list-all") return await listAll(req, res);
    if (body.action === "create") return await create(req, res, body);
    if (body.action === "delete") return await del(req, res, body);
    if (body.action === "update") return await update(req, res, body);
    if (body.action === "by-client") return await byClient(req, res, body);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

async function mine(req, res) {
  const user = await requireAuth(req);
  const data = await sb(`purchases?user_id=eq.${user.id}&select=*&order=purchase_date.desc`);
  res.status(200).json({ purchases: data });
}

async function listAll(req, res) {
  await requireAdmin(req);
  const data = await sb(`purchases?select=*,app_users(email,full_name,customer_number)&order=created_at.desc&limit=20`);
  res.status(200).json({ purchases: data });
}

async function create(req, res, body) {
  await requireAdmin(req);
  const clientEmail = String(body.client_email || "").trim().toLowerCase();
  if (!clientEmail) return res.status(400).json({ error: "Email del cliente requerido" });
  const users = await sb(`app_users?email=eq.${encodeURIComponent(clientEmail)}&select=id`);
  if (!users.length) {
    return res.status(404).json({ error: `No hay cliente con email "${clientEmail}". Creá la cuenta primero.` });
  }
  await sb(`purchases`, {
    method: "POST",
    body: JSON.stringify({
      user_id: users[0].id,
      purchase_date: body.purchase_date,
      platform: body.platform,
      modality: body.modality || null,
      account_email: body.account_email,
      account_password: body.account_password,
      verifier_codes: body.verifier_codes || null,
      games: body.games || null,
      game_name: body.game_name || null,
      notes: body.notes || null,
    }),
  });
  res.status(200).json({ ok: true });
}

async function del(req, res, body) {
  await requireAdmin(req);
  const id = String(body.id || "");
  if (!id) return res.status(400).json({ error: "ID requerido" });
  await sb(`purchases?id=eq.${id}`, { method: "DELETE" });
  res.status(200).json({ ok: true });
}

async function update(req, res, body) {
  await requireAdmin(req);
  const id = String(body.id || "");
  if (!id) return res.status(400).json({ error: "ID requerido" });
  const patch = {
    purchase_date: body.purchase_date,
    platform: body.platform,
    modality: body.modality || null,
    account_email: body.account_email,
    account_password: body.account_password,
    verifier_codes: body.verifier_codes || null,
    games: body.games || null,
    game_name: body.game_name || null,
    notes: body.notes || null,
  };
  await sb(`purchases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  res.status(200).json({ ok: true });
}

async function byClient(req, res, body) {
  await requireAdmin(req);
  let userQuery;
  if (body.customer_number) {
    userQuery = `app_users?customer_number=eq.${parseInt(body.customer_number)}&select=id,email,full_name,customer_number`;
  } else if (body.client_email) {
    const email = String(body.client_email).trim().toLowerCase();
    userQuery = `app_users?email=eq.${encodeURIComponent(email)}&select=id,email,full_name,customer_number`;
  } else {
    return res.status(400).json({ error: "customer_number o client_email requerido" });
  }
  const users = await sb(userQuery);
  if (!users.length) return res.status(404).json({ error: "Cliente no encontrado" });
  const client = users[0];
  const data = await sb(`purchases?user_id=eq.${client.id}&select=*,app_users(email,full_name,customer_number)&order=purchase_date.desc`);
  res.status(200).json({ purchases: data, client });
}
