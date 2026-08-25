// CRUD de compras. Cliente ve las propias, admin ve/crea/borra todas.
// POST /api/purchases con { action: "mine" | "list-all" | "create" | "delete", ... }

import { sb, requireAuth, requireAdmin, handleError, readJson, checkConfig, encryptSecret, decryptSecret } from "./_lib.js";
import { selectClients } from "./clients.js";

// account_password y verifier_codes son las credenciales reales de la cuenta
// de PSN/Xbox vendida: viajan cifradas en Supabase (ver encryptSecret en
// _lib.js). Se descifran acá, del lado del servidor, antes de mandarlas al
// panel/cliente — nunca quedan en texto plano en la base.
function decryptPurchaseRow(p) {
  return {
    ...p,
    account_password: decryptSecret(p.account_password),
    verifier_codes: decryptSecret(p.verifier_codes),
  };
}

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
    if (body.action === "filter") return await filter(req, res, body);
    if (body.action === "sales") return await sales(req, res, body);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

// Convierte el monto entrante (₡) en número válido, o null si no aplica.
function parseAmount(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Inserta/actualiza tolerando que la columna amount todavía no exista
// (migración add_purchase_amount.sql sin correr). Si Supabase se queja de
// la columna, reintenta sin ella para no romper la carga de compras.
async function sbWithAmount(path, options, hasAmount) {
  try {
    return await sb(path, options);
  } catch (err) {
    if (hasAmount && /amount|does not exist/i.test(err.message || "")) {
      const body = JSON.parse(options.body);
      delete body.amount;
      return await sb(path, { ...options, body: JSON.stringify(body) });
    }
    throw err;
  }
}

async function mine(req, res) {
  const user = await requireAuth(req);
  const data = await sb(`purchases?user_id=eq.${user.id}&select=*&order=purchase_date.desc`);
  res.status(200).json({ purchases: data.map(decryptPurchaseRow) });
}

async function listAll(req, res) {
  await requireAdmin(req);
  const data = await sb(`purchases?select=*,app_users(email,full_name,customer_number)&order=created_at.desc&limit=20`);
  res.status(200).json({ purchases: data.map(decryptPurchaseRow) });
}

async function create(req, res, body) {
  await requireAdmin(req);
  const clientEmail = String(body.client_email || "").trim().toLowerCase();
  if (!clientEmail) return res.status(400).json({ error: "Email del cliente requerido" });
  const users = await sb(`app_users?email=eq.${encodeURIComponent(clientEmail)}&select=id`);
  if (!users.length) {
    return res.status(404).json({ error: `No hay cliente con email "${clientEmail}". Creá la cuenta primero.` });
  }
  const row = {
    user_id: users[0].id,
    purchase_date: body.purchase_date,
    platform: body.platform,
    modality: body.modality || null,
    account_email: body.account_email,
    account_password: encryptSecret(body.account_password),
    verifier_codes: body.verifier_codes ? encryptSecret(body.verifier_codes) : null,
    games: body.games || null,
    game_name: body.game_name || null,
    notes: body.notes || null,
  };
  // Cofre de Oro: solo mandamos la columna cuando es un canje, así las ventas
  // normales no fallan si la migración add_cofre_oro.sql aún no se corrió.
  if (body.is_redemption) row.is_redemption = true;
  const amount = parseAmount(body.amount);
  if (amount != null) row.amount = amount;
  await sbWithAmount(`purchases`, { method: "POST", body: JSON.stringify(row) }, amount != null);
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
    account_password: encryptSecret(body.account_password),
    verifier_codes: body.verifier_codes ? encryptSecret(body.verifier_codes) : null,
    games: body.games || null,
    game_name: body.game_name || null,
    notes: body.notes || null,
  };
  // Ver nota en create(): la columna solo viaja cuando el admin marcó el canje.
  if (typeof body.is_redemption === "boolean") patch.is_redemption = body.is_redemption;
  // amount solo viaja cuando el campo vino en el request (undefined = no tocar).
  const touchesAmount = body.amount !== undefined;
  if (touchesAmount) patch.amount = parseAmount(body.amount);
  await sbWithAmount(`purchases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }, touchesAmount);
  res.status(200).json({ ok: true });
}

async function byClient(req, res, body) {
  await requireAdmin(req);
  let userQuery;
  if (body.customer_number) {
    userQuery = `app_users?customer_number=eq.${parseInt(body.customer_number)}`;
  } else if (body.client_email) {
    const email = String(body.client_email).trim().toLowerCase();
    userQuery = `app_users?email=eq.${encodeURIComponent(email)}`;
  } else {
    return res.status(400).json({ error: "customer_number o client_email requerido" });
  }
  const users = await selectClients(userQuery);
  if (!users.length) return res.status(404).json({ error: "Cliente no encontrado" });
  const client = users[0];
  const data = await sb(`purchases?user_id=eq.${client.id}&select=*,app_users(email,full_name,customer_number)&order=purchase_date.desc`);
  res.status(200).json({ purchases: data.map(decryptPurchaseRow), client });
}

// Filtro combinado de compras: cliente (email o RM-código) + consola + fecha.
// Cualquier combinación es opcional; sin filtros devuelve las más recientes.
async function filter(req, res, body) {
  await requireAdmin(req);
  let client = null;
  const term = String(body.term || "").trim();
  if (term) {
    const rm = term.match(/^RM-?(\d+)$/i);
    const userQuery = rm
      ? `app_users?customer_number=eq.${parseInt(rm[1], 10)}`
      : `app_users?email=eq.${encodeURIComponent(term.toLowerCase())}`;
    const users = await selectClients(userQuery);
    if (!users.length) return res.status(404).json({ error: "Cliente no encontrado" });
    client = users[0];
  }
  let q = `purchases?select=*,app_users(email,full_name,customer_number)&order=purchase_date.desc&limit=200`;
  if (client) q += `&user_id=eq.${client.id}`;
  if (body.platform) q += `&platform=eq.${encodeURIComponent(String(body.platform))}`;
  if (body.date) q += `&purchase_date=eq.${encodeURIComponent(String(body.date))}`;
  const purchases = await sb(q);
  res.status(200).json({ purchases: purchases.map(decryptPurchaseRow), client });
}

// Historial de ventas para reportes: trae las compras dentro de un rango de
// fechas (desde/hasta, ambos opcionales) con lo mínimo para agregar por día,
// mes y consola. La suma en colones y los desgloses se arman en el cliente.
async function sales(req, res, body) {
  await requireAdmin(req);
  const from = String(body.from || "").trim();
  const to = String(body.to || "").trim();
  let q = `purchases?select=id,purchase_date,platform,modality,amount,is_redemption&order=purchase_date.asc&limit=10000`;
  if (from) q += `&purchase_date=gte.${encodeURIComponent(from)}`;
  if (to) q += `&purchase_date=lte.${encodeURIComponent(to)}`;
  let rows;
  try {
    rows = await sb(q);
  } catch (err) {
    // Si la columna amount todavía no existe, la sacamos del select y seguimos.
    if (/amount|does not exist/i.test(err.message || "")) {
      rows = await sb(q.replace(",amount", ""));
    } else {
      throw err;
    }
  }
  res.status(200).json({ sales: rows });
}
