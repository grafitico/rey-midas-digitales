// CRUD de compras. Cliente ve las propias, admin ve/crea/borra todas.
// POST /api/purchases con { action: "mine" | "list-all" | "create" | "delete", ... }

import { sb, requireAuth, requireAdmin, requireStaff, handleError, readJson, checkConfig, encryptSecret, decryptSecret } from "./_lib.js";
import { selectClients } from "./clients.js";
import { findCover } from "./og.js";
import { MAIL_DOMAIN, cleanLocal, makePassword, mailboxExists, createMailbox, mailStatus, readSonyMail, canCreateMail, testCpanel } from "./_correo.js";

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
    if (body.action === "inventario-combo") return await inventarioCombo(req, res);
    if (body.action === "mine") return await mine(req, res);
    if (body.action === "list-all") return await listAll(req, res);
    if (body.action === "create") return await create(req, res, body);
    if (body.action === "delete") return await del(req, res, body);
    if (body.action === "update") return await update(req, res, body);
    if (body.action === "by-client") return await byClient(req, res, body);
    if (body.action === "filter") return await filter(req, res, body);
    if (body.action === "sales") return await sales(req, res, body);
    if (body.action === "accounts") return await accounts(req, res);
    if (body.action === "by-account") return await byAccount(req, res, body);
    if (body.action === "cofre-adjust") return await cofreAdjust(req, res, body);
    if (body.action === "cuenta-save") return await cuentaSave(req, res, body);
    if (body.action === "cuenta-delete") return await cuentaDelete(req, res, body);
    if (body.action === "client-lookup") return await clientLookup(req, res, body);
    if (body.action === "cuenta-nueva") return await cuentaNueva(req, res, body);
    if (body.action === "correo-leer") return await correoLeer(req, res, body);
    if (body.action === "correo-estado") return await correoEstado(req, res, body);
    if (body.action === "correo-sugerir") return await correoSugerir(req, res, body);
    if (body.action === "cofre-adjust-delete") return await cofreAdjustDelete(req, res, body);
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
  const ajustes = await cofreAjustesOf(user.id);
  // Portada chiquita de cada juego (si se encuentra en el catálogo). Si algo
  // falla, las compras se muestran igual, sin portada.
  const withCover = p => {
    try { return { ...p, cover: findCover(p.game_name, p.platform) || "" }; } catch { return p; }
  };
  res.status(200).json({ purchases: data.map(decryptPurchaseRow).map(withCover), ajustes });
}

async function listAll(req, res) {
  await requireAdmin(req);
  const data = await sb(`purchases?select=*,app_users(email,full_name,customer_number)&order=created_at.desc&limit=20`);
  res.status(200).json({ purchases: data.map(decryptPurchaseRow) });
}

// Admin o asistente. El asistente identifica al cliente por su RM y no manda
// contraseña cuando la cuenta ya existe: el servidor la toma de la cuenta
// registrada o de la última venta de ese correo (así nunca la ve).
async function create(req, res, body) {
  const staff = await requireStaff(req);
  const clientEmail = String(body.client_email || "").trim().toLowerCase();
  const rmNum = parseInt(String(body.customer_number || "").replace(/\D/g, ""), 10);
  let users;
  if (clientEmail && staff.admin) {
    users = await sb(`app_users?email=eq.${encodeURIComponent(clientEmail)}&select=id`);
    if (!users.length) return res.status(404).json({ error: `No hay cliente con email "${clientEmail}". Creá la cuenta primero.` });
  } else if (rmNum > 0) {
    users = await sb(`app_users?customer_number=eq.${rmNum}&select=id`);
    if (!users.length) return res.status(404).json({ error: `No hay cliente con el código RM-${String(rmNum).padStart(4, "0")}.` });
  } else {
    return res.status(400).json({ error: staff.admin ? "Email del cliente requerido" : "Código RM del cliente requerido" });
  }
  if (!body.account_email || !String(body.account_email).trim()) return res.status(400).json({ error: "Falta el correo de la cuenta" });
  if (!body.platform) return res.status(400).json({ error: "Falta la plataforma" });
  if (!body.account_password) {
    const acc = String(body.account_email).trim().toLowerCase();
    const cuenta = await cuentaByEmail(acc);
    let pwd = cuenta?.password ? decryptSecret(cuenta.password) : "";
    if (!pwd) {
      const prev = await sb(`purchases?account_email=ilike.${likeExact(acc)}&select=account_email,account_password,created_at&order=created_at.desc&limit=20`);
      const hit = prev.find(r => String(r.account_email || "").trim().toLowerCase() === acc && r.account_password);
      pwd = hit ? decryptSecret(hit.account_password) : "";
    }
    if (!pwd) return res.status(400).json({ error: "Falta la contraseña: esa cuenta no está registrada ni tiene ventas anteriores." });
    body.account_password = pwd;
  }
  if (!body.purchase_date) body.purchase_date = new Date().toISOString().slice(0, 10);
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
  if (staff.assistant) console.log(`[asistente] venta cargada (acceso ${staff.tid}): ${row.platform} ${row.modality || ""} → cliente ${users[0].id}`);
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
  const ajustes = await cofreAjustesOf(client.id, true);
  res.status(200).json({ purchases: data.map(decryptPurchaseRow), client, ajustes });
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

// Ventas por cuenta y juego (admin): TODAS las compras con lo justo para
// agruparlas por correo de la cuenta vendida y por juego, y calcular los cupos
// libres. Sin contraseñas ni códigos del verificador: el reporte no los usa.
async function accounts(req, res) {
  const staff = await requireStaff(req);
  const cols = "id,purchase_date,platform,modality,amount,is_redemption,account_email,game_name,app_users(full_name,customer_number,email)";
  const q = `purchases?select=${cols}&order=purchase_date.asc&limit=20000`;
  let rows;
  try {
    rows = await sb(q);
  } catch (err) {
    // Tolera que falten columnas de migraciones viejas (amount / is_redemption).
    if (/amount|is_redemption|does not exist/i.test(err.message || "")) {
      rows = await sb(q.replace(",amount", "").replace(",is_redemption", ""));
    } else {
      throw err;
    }
  }
  // Cuentas registradas (sin contraseña). null = falta la migración add_cuentas.sql.
  let cuentas = null;
  try {
    cuentas = await sb(`cuentas?select=id,plataforma,juego,correo,region,tipo,notas,created_at,costo_usd,fecha_compra&order=created_at.asc&limit=20000`);
  } catch (err) {
    if (costoMissing(err)) {
      // Falta add_cuenta_costo.sql: se listan igual, sin costo.
      cuentas = await sb(`cuentas?select=id,plataforma,juego,correo,region,tipo,notas,created_at&order=created_at.asc&limit=20000`);
    } else if (!ajustesMissing(err)) throw err;
  }
  // El asistente ve nombre y RM del cliente de cada cupo, no su correo.
  if (staff.assistant) {
    rows = rows.map(r => ({ ...r, app_users: r.app_users ? { full_name: r.app_users.full_name, customer_number: r.app_users.customer_number } : null }));
  }
  res.status(200).json({ purchases: rows, cuentas });
}

// Todas las ventas de UNA cuenta (correo de la cuenta vendida), completas y
// descifradas: para editar un cupo desde Ventas y para precargar contraseña y
// juegos al vender un cupo libre de una cuenta que ya existe.
async function byAccount(req, res, body) {
  await requireAdmin(req);
  const email = String(body.account_email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Correo de la cuenta requerido" });
  // ilike sin importar mayúsculas; *…* tolera espacios guardados alrededor del
  // correo y el filtro exacto de abajo descarta lo demás. Los _ y % del correo
  // se escapan para que no funcionen como comodines.
  const pattern = email.replace(/[\\%_]/g, m => "\\" + m);
  const rows = await sb(`purchases?account_email=ilike.${encodeURIComponent("*" + pattern + "*")}&select=*,app_users(email,full_name,customer_number)&order=purchase_date.asc&limit=50`);
  const exact = rows.filter(r => String(r.account_email || "").trim().toLowerCase() === email);
  const cuenta = await cuentaByEmail(email);
  res.status(200).json({
    purchases: exact.map(decryptPurchaseRow),
    cuenta: cuenta ? { ...cuenta, password: decryptSecret(cuenta.password) } : null,
  });
}

// ===== Inventario público: 3X1 Combo y sección "Entrega inmediata" =====
// Juegos con cupos LIBRES en cuentas ya compradas (primarias por consola y
// secundarias): el combo los muestra primero y /entrega-inmediata los ofrece,
// porque venderlos no requiere comprar otra licencia. Solo nombre del juego
// y cuántos cupos libres hay:
// nada de correos, contraseñas ni clientes. Se guarda 10 minutos en memoria
// (un combo abierto por muchos no consulta Supabase cada vez).
const INV_COMBO_TTL_MS = 10 * 60 * 1000;
let invComboCache = { t: 0, data: null };

async function inventarioCombo(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  if (invComboCache.data && Date.now() - invComboCache.t < INV_COMBO_TTL_MS) {
    return res.status(200).json(invComboCache.data);
  }
  let cuentas = [];
  try {
    cuentas = await sb(`cuentas?select=plataforma,juego,correo,tipo&limit=20000`);
  } catch (err) {
    if (!ajustesMissing(err)) throw err;
  }
  const ventas = await sb(`purchases?select=platform,modality,account_email,game_name&limit=20000`);
  const acc = new Map(); // correo → { fam, juego, tipo, usados }
  const key = e => String(e || "").trim().toLowerCase();
  for (const c of cuentas) {
    if (!key(c.correo)) continue;
    acc.set(key(c.correo), { fam: c.plataforma, juego: c.juego, tipo: c.tipo, ps4: 0, ps5: 0, pri: 0, sec: 0, full: false });
  }
  for (const v of ventas) {
    const k = key(v.account_email);
    if (!k) continue;
    const plat = String(v.platform || "");
    const fam = /xbox/i.test(plat) ? "Xbox" : /nintendo|switch/i.test(plat) ? "Nintendo" : "PlayStation";
    if (!acc.has(k)) acc.set(k, { fam, juego: v.game_name, tipo: "auto", ps4: 0, ps5: 0, pri: 0, sec: 0, full: false });
    const a = acc.get(k);
    if (!a.juego && v.game_name) a.juego = v.game_name;
    const mod = String(v.modality || "").toLowerCase();
    if (mod === "individual" || mod === "bundle") a.full = true;
    else if (mod.startsWith("secund")) a.sec++; // la secundaria no ocupa primarias
    else if (fam === "PlayStation") { if (/ps5/i.test(plat)) a.ps5++; else if (/ps4/i.test(plat)) a.ps4++; }
    else a.pri++;
  }
  const juegos = new Map();
  for (const a of acc.values()) {
    if (a.full || !a.juego || a.fam === "Nintendo") continue;
    let libres;
    if (a.fam === "Xbox") libres = { xbox: Math.max(0, 2 - a.pri) };
    else if (a.tipo === "ps5only") libres = { ps5: Math.max(0, 2 - a.ps5) };
    else libres = { ps4: Math.max(0, 2 - a.ps4), ps5: Math.max(0, 2 - a.ps5) };
    libres.sec = Math.max(0, 1 - a.sec); // secundaria: 1 por cuenta (PlayStation y Xbox)
    if (!Object.values(libres).some(n => n > 0)) continue;
    const nombre = String(a.juego).trim().slice(0, 120);
    const k = nombre.toLowerCase();
    const j = juegos.get(k) || { juego: nombre, plataforma: a.fam, ps4: 0, ps5: 0, xbox: 0, sec: 0 };
    for (const [c, n] of Object.entries(libres)) j[c] += n;
    juegos.set(k, j);
  }
  const data = { actualizado: new Date().toISOString(), juegos: [...juegos.values()] };
  invComboCache = { t: Date.now(), data };
  res.status(200).json(data);
}

// ===== Ajustes manuales del Cofre de Oro (migrations/add_cofre_ajustes.sql) =====
// Tabla inexistente: PostgREST responde PGRST205 ("not find the table … in the
// schema cache") o Postgres 42P01. No usamos el nombre de la tabla en el regex
// porque otros errores (p. ej. la FK cofre_ajustes_user_id_fkey) también lo traen.
function ajustesMissing(err) {
  return ["PGRST205", "42P01"].includes(err?.data?.code) || /schema cache|does not exist/i.test(err?.message || "");
}

// Ajustes de un cliente. Si la tabla todavía no existe devuelve [] (el cofre
// sigue funcionando solo con las compras); para el admin, null = "falta la migración".
async function cofreAjustesOf(userId, forAdmin = false) {
  try {
    return await sb(`cofre_ajustes?user_id=eq.${userId}&select=id,delta,note,created_at&order=created_at.asc`);
  } catch (err) {
    if (ajustesMissing(err)) return forAdmin ? null : [];
    throw err;
  }
}

function missingTableError() {
  const e = new Error("Falta crear la tabla de ajustes: corré migrations/add_cofre_ajustes.sql en Supabase (SQL Editor → New query → Run).");
  e.status = 500;
  return e;
}

async function cofreAdjust(req, res, body) {
  await requireAdmin(req);
  const userId = String(body.client_id || "");
  const delta = Number(body.delta);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: "Cliente inválido" });
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 50) {
    return res.status(400).json({ error: "La cantidad tiene que ser un número entero entre -50 y 50 (sin 0)" });
  }
  const note = body.note ? String(body.note).trim().slice(0, 200) : null;
  try {
    await sb(`cofre_ajustes`, { method: "POST", body: JSON.stringify({ user_id: userId, delta, note }) });
  } catch (err) {
    if (ajustesMissing(err)) throw missingTableError();
    throw err;
  }
  res.status(200).json({ ok: true });
}

async function cofreAdjustDelete(req, res, body) {
  await requireAdmin(req);
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Ajuste inválido" });
  try {
    await sb(`cofre_ajustes?id=eq.${id}`, { method: "DELETE" });
  } catch (err) {
    if (ajustesMissing(err)) throw missingTableError();
    throw err;
  }
  res.status(200).json({ ok: true });
}

// ===== Cuentas registradas (migrations/add_cuentas.sql) =====
const CUENTA_PLATAFORMAS = ["PlayStation", "Xbox", "Nintendo"];
const CUENTA_TIPOS = ["auto", "cross", "ps5only"];

// Costo de la licencia (migrations/add_cuenta_costo.sql). Devuelve los campos
// a guardar, o {} si no vinieron. Lanza 400 si el valor no tiene sentido.
function costoFields(body) {
  const out = {};
  if (body.costo_usd !== undefined) {
    // Vacío = no tocarlo (así editar una cuenta no depende de la migración).
    const raw = String(body.costo_usd ?? "").replace(",", ".").trim();
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1000) { const e = new Error("Costo inválido: poné el precio en dólares (ej. 19.99)"); e.status = 400; throw e; }
      out.costo_usd = Math.round(n * 100) / 100;
    }
  }
  if (body.fecha_compra !== undefined) {
    const d = String(body.fecha_compra || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) { const e = new Error("Fecha de compra inválida"); e.status = 400; throw e; }
    if (d) out.fecha_compra = d;
  }
  return out;
}
// ¿El error es porque todavía no se corrió add_cuenta_costo.sql?
const costoMissing = err => /costo_usd|fecha_compra/i.test(err?.message || "") || /costo_usd|fecha_compra/i.test(JSON.stringify(err?.data || {}));
const costoMissingError = () => Object.assign(new Error("Para guardar el costo falta correr migrations/add_cuenta_costo.sql en Supabase (SQL Editor → New query → Run). La cuenta no se guardó."), { status: 500 });

function likeExact(email) {
  return encodeURIComponent("*" + email.replace(/[\\%_]/g, m => "\\" + m) + "*");
}

// La cuenta registrada con ese correo (sin mayúsculas/espacios), o null.
async function cuentaByEmail(email) {
  let rows;
  try {
    rows = await sb(`cuentas?correo=ilike.${likeExact(email)}&select=*&limit=20`);
  } catch (err) {
    if (ajustesMissing(err)) return null;
    throw err;
  }
  return rows.find(r => String(r.correo || "").trim().toLowerCase() === email) || null;
}

function cuentasMissingError() {
  const e = new Error("Falta crear la tabla de cuentas: corré migrations/add_cuentas.sql en Supabase (SQL Editor → New query → Run).");
  e.status = 500;
  return e;
}

function cleanText(v, max) {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : null;
}

async function cuentaSave(req, res, body) {
  const staff = await requireStaff(req);
  const id = body.id ? String(body.id) : "";
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Cuenta inválida" });
  const plataforma = String(body.plataforma || "");
  const juego = cleanText(body.juego, 200);
  const correo = cleanText(body.correo, 200);
  const tipo = String(body.tipo || "auto");
  if (!CUENTA_PLATAFORMAS.includes(plataforma)) return res.status(400).json({ error: "Plataforma inválida" });
  if (!juego) return res.status(400).json({ error: "Falta el juego" });
  if (!correo) return res.status(400).json({ error: "Falta el correo de la cuenta" });
  if (!CUENTA_TIPOS.includes(tipo)) return res.status(400).json({ error: "Tipo inválido" });
  const row = {
    plataforma, juego, correo, tipo,
    region: cleanText(body.region, 40),
    notas: cleanText(body.notas, 500),
    updated_at: new Date().toISOString(),
  };
  Object.assign(row, costoFields(body));
  const pwd = cleanText(body.password, 200);
  // Al editar, contraseña vacía = no tocarla.
  if (pwd) row.password = encryptSecret(pwd);
  else if (!id) row.password = null;

  try {
    // El correo no puede repetirse (además del índice único, para dar un mensaje claro).
    const otra = await cuentaByEmail(correo.toLowerCase());
    if (otra && otra.id !== id) return res.status(409).json({ error: "Ya hay una cuenta registrada con ese correo." });
    if (id) {
      const prev = await sb(`cuentas?id=eq.${id}&select=correo`);
      if (!prev.length) return res.status(404).json({ error: "Esa cuenta ya no existe" });
      await sb(`cuentas?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(row) });
      // Si cambió el correo, las ventas de esa cuenta se mueven al correo nuevo.
      const before = String(prev[0].correo || "").trim().toLowerCase();
      if (before && before !== correo.toLowerCase()) {
        const ventas = await sb(`purchases?account_email=ilike.${likeExact(before)}&select=id,account_email&limit=200`);
        const ids = ventas.filter(v => String(v.account_email || "").trim().toLowerCase() === before).map(v => v.id);
        if (ids.length) {
          await sb(`purchases?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ account_email: correo }) });
        }
      }
    } else {
      await sb(`cuentas`, { method: "POST", body: JSON.stringify(row) });
    }
  } catch (err) {
    if (costoMissing(err)) throw costoMissingError();
    if (ajustesMissing(err)) throw cuentasMissingError();
    if (err?.data?.code === "23505") return res.status(409).json({ error: "Ya hay una cuenta registrada con ese correo." });
    throw err;
  }
  if (staff.assistant) console.log(`[asistente] cuenta ${id ? "editada" : "registrada"} (acceso ${staff.tid}): ${correo}`);
  res.status(200).json({ ok: true });
}

// Borra la cuenta registrada. Sus ventas NO se tocan (siguen en purchases).
async function cuentaDelete(req, res, body) {
  await requireAdmin(req);
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Cuenta inválida" });
  try {
    await sb(`cuentas?id=eq.${id}`, { method: "DELETE" });
  } catch (err) {
    if (ajustesMissing(err)) throw cuentasMissingError();
    throw err;
  }
  res.status(200).json({ ok: true });
}

// Buscar un cliente por su RM (admin o asistente): solo nombre, RM y consola,
// para confirmar a quién se le carga la venta. Sin correo ni teléfono.
async function clientLookup(req, res, body) {
  await requireStaff(req);
  const n = parseInt(String(body.customer_number || "").replace(/\D/g, ""), 10);
  if (!(n > 0)) return res.status(400).json({ error: "Código RM inválido" });
  const users = await selectClients(`app_users?customer_number=eq.${n}`);
  if (!users.length) return res.status(404).json({ error: `No hay cliente con el código RM-${String(n).padStart(4, "0")}.` });
  const u = users[0];
  res.status(200).json({ client: { customer_number: u.customer_number, full_name: u.full_name || "", console: u.console || "" } });
}

// ===== Cuenta nueva con correo en Banahosting (admin o asistente) =====
// Crea el buzón <usuario>@reymidascr.com en cPanel, genera una contraseña
// (la misma para el correo y para PlayStation) y registra la cuenta en el
// cuadro. La contraseña NO vuelve en la respuesta: se ve en el panel
// (✎ Editar cuenta) o la completa el servidor al cargar ventas.
async function cuentaNueva(req, res, body) {
  const staff = await requireStaff(req);
  const local = cleanLocal(body.correo);
  if (!local) return res.status(400).json({ error: `Correo inválido: usá solo letras, números, punto o guion (ej. fc26-08), sin @${MAIL_DOMAIN}.` });
  const correo = `${local}@${MAIL_DOMAIN}`;
  const plataforma = String(body.plataforma || "PlayStation");
  const juego = cleanText(body.juego, 200);
  const tipo = String(body.tipo || "auto");
  if (!CUENTA_PLATAFORMAS.includes(plataforma)) return res.status(400).json({ error: "Plataforma inválida" });
  if (!juego) return res.status(400).json({ error: "Falta el juego" });
  if (!CUENTA_TIPOS.includes(tipo)) return res.status(400).json({ error: "Tipo inválido" });
  const crearCorreo = body.crear_correo !== false;
  const costo = costoFields(body);

  // Nada a medias: primero todo lo que puede fallar sin efectos.
  if (await cuentaByEmail(correo)) return res.status(409).json({ error: "Ya hay una cuenta registrada con ese correo." });
  if (crearCorreo && mailboxExists(local)) return res.status(409).json({ error: "Ese correo ya existe en el hosting. Elegí otro nombre." });

  if (crearCorreo && !canCreateMail()) {
    return res.status(503).json({ error: "Crear correos automáticamente no está activado todavía. Crealo a mano en cPanel → Cuentas de correo y registrá la cuenta sin marcar \"Crear el correo\"." });
  }
  // Primero se guarda la cuenta con su contraseña y DESPUÉS se crea el
  // correo: si algo corta el pedido a la mitad, nunca queda un buzón cuya
  // contraseña no esté guardada. Si cPanel falla, se borra la cuenta recién
  // creada para no dejar un registro sin correo.
  const password = makePassword();
  let creada;
  try {
    creada = await sb(`cuentas`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      plataforma, juego, correo, tipo, password: encryptSecret(password),
      region: cleanText(body.region, 40), notas: cleanText(body.notas, 500), updated_at: new Date().toISOString(),
      ...costo,
    }) });
  } catch (err) {
    if (costoMissing(err)) throw costoMissingError();
    throw ajustesMissing(err) ? cuentasMissingError() : err;
  }
  if (crearCorreo) {
    try {
      await createMailbox(local, password);
    } catch (err) {
      const id = creada?.[0]?.id;
      if (id) { try { await sb(`cuentas?id=eq.${id}`, { method: "DELETE" }); } catch {} }
      throw err;
    }
  }
  console.log(`[cuentas] cuenta nueva ${correo} (${staff.assistant ? "asistente " + staff.tid : "admin"})${crearCorreo ? " + correo en cPanel" : ""}`);
  res.status(200).json({ ok: true, correo, correo_creado: crearCorreo });
}

// Últimos correos de PlayStation de un buzón @reymidascr.com: código o enlace
// de verificación. Solo mensajes de Sony de los últimos 7 días.
async function correoLeer(req, res, body) {
  await requireStaff(req);
  const local = cleanLocal(body.correo);
  if (!local) return res.status(400).json({ error: `Solo se pueden leer correos @${MAIL_DOMAIN}.` });
  const r = readSonyMail(local);
  if (!r.exists) return res.status(404).json({ error: `No encontré el buzón ${local}@${MAIL_DOMAIN} en el hosting.` });
  res.status(200).json({ correo: `${local}@${MAIL_DOMAIN}`, mensajes: r.messages });
}

// Diagnóstico sin cambios: ¿cPanel responde y se ven los buzones?
async function correoEstado(req, res, body = {}) {
  await requireStaff(req);
  const st = mailStatus();
  if (body.probar && st.crear_correos) Object.assign(st, await testCpanel());
  res.status(200).json(st);
}

// Siguiente correo libre con el estilo de la tienda: <juego+edición><número>
// (gta6ultimate1, gta6ultimate2…). "Libre" = no existe el buzón en el hosting
// NI hay una cuenta o venta con ese correo en la tienda.
async function correoSugerir(req, res, body) {
  await requireStaff(req);
  const base = String(body.base || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  if (base.length < 3) return res.status(400).json({ error: "Poné al menos 3 letras del juego (ej. gta6ultimate)." });
  const usados = new Set();
  try {
    for (const c of await sb(`cuentas?correo=ilike.${encodeURIComponent(base + "*@" + MAIL_DOMAIN)}&select=correo&limit=500`)) usados.add(String(c.correo).trim().toLowerCase());
  } catch (err) { if (!ajustesMissing(err)) throw err; }
  for (const p of await sb(`purchases?account_email=ilike.${encodeURIComponent("*" + base + "*@" + MAIL_DOMAIN + "*")}&select=account_email&limit=1000`)) usados.add(String(p.account_email).trim().toLowerCase());
  const ocupados = [];
  // Si el nombre ya termina en número (fc26, rdr2) se separa con guion: fc26-1.
  const sep = /\d$/.test(base) ? "-" : "";
  for (let n = 1; n <= 200; n++) {
    const local = `${base}${sep}${n}`;
    if (mailboxExists(local) || usados.has(`${local}@${MAIL_DOMAIN}`)) { ocupados.push(local); continue; }
    return res.status(200).json({ sugerido: `${local}@${MAIL_DOMAIN}`, local, ocupados });
  }
  res.status(409).json({ error: "No encontré un número libre hasta el 200: probá con otro nombre base." });
}
