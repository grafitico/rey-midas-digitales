// CRUD de compras. Cliente ve las propias, admin ve/crea/borra todas.
// POST /api/purchases con { action: "mine" | "list-all" | "create" | "delete", ... }

import { sb, sbAll, requireAuth, requireAdmin, requireStaff, handleError, readJson, checkConfig, encryptSecret, decryptSecret, hashPassword } from "./_lib.js";
import crypto from "crypto";
import { registrarCompra } from "./_ranking.js";
import { selectClients } from "./clients.js";
import { findCover } from "./og.js";
import { CODIGOS_POR_VENTA, TOPE_POR_VENTA, codigosMissing, codigosMissingError, parseCodigos, leerBoveda, resumenBoveda, guardarBoveda, asignar, cargarSet, ventasDeCuenta, sembrarDesdeVentas, codigosDeVenta, reponerUsado, desmarcarUsado } from "./_codigos.js";
import { MAIL_DOMAIN, cleanLocal, makePassword, mailboxExists, createMailbox, mailStatus, readSonyMail, canCreateMail, testCpanel, catchAllActivo, CATCHALL_LOCAL } from "./_correo.js";

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

// Una venta o un cambio de cuenta cambia los cupos libres: se descarta el
// inventario público guardado para que Entrega inmediata lo vea al instante.
async function trasCambio(p) {
  try { return await p; } finally { invComboCache = { t: 0, data: null }; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    const body = await readJson(req);
    if (body.action === "inventario-combo") return await inventarioCombo(req, res);
    if (body.action === "importar-excel") return await importarExcel(req, res, body);
    if (body.action === "mine") return await mine(req, res);
    if (body.action === "list-all") return await listAll(req, res);
    if (body.action === "create") return await trasCambio(create(req, res, body));
    if (body.action === "delete") return await trasCambio(del(req, res, body));
    if (body.action === "update") return await trasCambio(update(req, res, body));
    if (body.action === "by-client") return await byClient(req, res, body);
    if (body.action === "filter") return await filter(req, res, body);
    if (body.action === "sales") return await sales(req, res, body);
    if (body.action === "accounts") return await accounts(req, res);
    if (body.action === "by-account") return await byAccount(req, res, body);
    if (body.action === "cofre-adjust") return await cofreAdjust(req, res, body);
    if (body.action === "cuenta-save") return await trasCambio(cuentaSave(req, res, body));
    if (body.action === "cuenta-delete") return await trasCambio(cuentaDelete(req, res, body));
    if (body.action === "client-lookup") return await clientLookup(req, res, body);
    if (body.action === "cuenta-nueva") return await trasCambio(cuentaNueva(req, res, body));
    if (body.action === "correo-leer") return await correoLeer(req, res, body);
    if (body.action === "correo-estado") return await correoEstado(req, res, body);
    if (body.action === "correo-sugerir") return await correoSugerir(req, res, body);
    if (body.action === "cofre-adjust-delete") return await cofreAdjustDelete(req, res, body);
    if (body.action === "codigos-cuenta") return await codigosCuenta(req, res, body);
    if (body.action === "codigos-guardar") return await codigosGuardar(req, res, body);
    if (body.action === "codigos-entregar") return await codigosEntregar(req, res, body);
    if (body.action === "codigos-migrar") return await codigosMigrar(req, res, body);
    if (body.action === "codigo-usado") return await codigoUsado(req, res, body);
    if (body.action === "codigos-marcar") return await codigosMarcar(req, res, body);
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
    users = await sb(`app_users?email=eq.${encodeURIComponent(clientEmail)}&select=id,customer_number`);
    if (!users.length) return res.status(404).json({ error: `No hay cliente con email "${clientEmail}". Creá la cuenta primero.` });
  } else if (rmNum > 0) {
    users = await sb(`app_users?customer_number=eq.${rmNum}&select=id,customer_number`);
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
  // Bóveda de códigos: los códigos que vengan en el formulario son los de la
  // CUENTA (un set nuevo de Sony o los de una cuenta nueva); la venta recibe
  // solo CODIGOS_POR_VENTA. Sin la migración, se guarda como antes.
  const acc = String(body.account_email).trim().toLowerCase();
  let boveda = null;
  try {
    boveda = await prepararBoveda(acc, body);
  } catch (err) {
    if (!codigosMissing(err)) throw err;
  }
  const row = {
    user_id: users[0].id,
    purchase_date: body.purchase_date,
    platform: body.platform,
    modality: body.modality || null,
    account_email: body.account_email,
    account_password: encryptSecret(body.account_password),
    verifier_codes: !boveda && body.verifier_codes ? encryptSecret(body.verifier_codes) : null,
    games: body.games || null,
    game_name: body.game_name || null,
    notes: body.notes || null,
  };
  // Cofre de Oro: solo mandamos la columna cuando es un canje, así las ventas
  // normales no fallan si la migración add_cofre_oro.sql aún no se corrió.
  if (body.is_redemption) row.is_redemption = true;
  const amount = parseAmount(body.amount);
  if (amount != null) row.amount = amount;
  const creada = await sbWithAmount(`purchases`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }, amount != null);
  const ventaId = Array.isArray(creada) ? creada[0]?.id : null;
  let codigos = null;
  if (boveda && ventaId) {
    const pedidos = Math.max(0, Math.min(5, parseInt(body.codigos_entregar ?? CODIGOS_POR_VENTA, 10) || 0));
    const dados = asignar(boveda.lista, pedidos, { venta: ventaId, rm: users[0].customer_number });
    if (dados.length) await sb(`purchases?id=eq.${ventaId}`, { method: "PATCH", body: JSON.stringify({ verifier_codes: encryptSecret(dados.join("\n")) }) });
    await guardarBoveda(boveda.cuenta.id, boveda.lista);
    await aplicarRecortes(boveda.recortes); // recién con la bóveda guardada
    await sincronizarVentas(boveda.reasignadas, boveda.lista);
    codigos = { entregados: dados.length, ...resumenBoveda(boveda.lista) };
  }
  // Ranking: si el cliente llegó invitado por otro, +50 al que lo invitó.
  await registrarCompra({ purchaseId: ventaId, userId: users[0].id, esCanje: !!row.is_redemption });
  if (staff.assistant) console.log(`[asistente] venta cargada (acceso ${staff.tid}): ${row.platform} ${row.modality || ""} → cliente ${users[0].id}`);
  res.status(200).json({ ok: true, id: ventaId, codigos });
}

// Cuenta registrada de ese correo (se crea si solo existía en ventas) con su
// bóveda lista: sembrada desde las ventas la primera vez y con el set nuevo
// del formulario, si vino. Lanza codigosMissing si falta la migración.
async function prepararBoveda(acc, body) {
  await bovedaDisponible(); // sin la columna, nada se toca (lanza codigosMissing)
  let cuenta = await cuentaByEmail(acc);
  const nuevos = parseCodigos(body.verifier_codes);
  if (!cuenta) {
    const fam = /xbox/i.test(body.platform || "") ? "Xbox" : /switch|nintendo/i.test(body.platform || "") ? "Nintendo" : "PlayStation";
    const creada = await sb(`cuentas`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      plataforma: fam, juego: cleanText(body.game_name, 200) || "(sin juego)", correo: String(body.account_email).trim(), tipo: "auto",
    }) });
    cuenta = Array.isArray(creada) ? creada[0] : null;
    if (!cuenta) return null;
  }
  let lista = leerBoveda(cuenta), recortes = [];
  if (!lista) ({ lista, recortes } = sembrarDesdeVentas(await ventasDeCuenta(acc)));
  const reasignadas = nuevos.length ? cargarSet(lista, nuevos, "reemplazar").reasignadas : [];
  return { cuenta, lista, recortes, reasignadas };
}

let bovedaOk = false;
async function bovedaDisponible() {
  if (bovedaOk) return;
  await sb(`cuentas?select=codigos&limit=1`);
  bovedaOk = true;
}

// Ventas cuyos códigos cambiaron en la bóveda (set nuevo de Sony): cada una
// queda con sus vigentes. Va DESPUÉS de guardar la bóveda y de los recortes.
async function sincronizarVentas(reasignadas, lista) {
  for (const r of reasignadas || []) {
    const v = (await sb(`purchases?id=eq.${r.venta}&select=id,verifier_codes`))[0];
    if (!v) continue;
    const cods = codigosDeVenta(decryptSecret(v.verifier_codes) || "", lista, r.venta);
    await sb(`purchases?id=eq.${r.venta}`, { method: "PATCH", body: JSON.stringify({ verifier_codes: cods.length ? encryptSecret(cods.join("\n")) : null }) });
  }
}

// Ventas de clientes reales que tenían todos los códigos: quedan con los suyos.
async function aplicarRecortes(recortes) {
  for (const r of recortes) {
    await sb(`purchases?id=eq.${r.venta}`, { method: "PATCH", body: JSON.stringify({ verifier_codes: r.codigos.length ? encryptSecret(r.codigos.join("\n")) : null }) });
  }
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
    rows = await sbAll(q);
  } catch (err) {
    // Si la columna amount todavía no existe, la sacamos del select y seguimos.
    if (/amount|does not exist/i.test(err.message || "")) {
      rows = await sbAll(q.replace(",amount", ""));
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
  const cols = "id,purchase_date,platform,modality,amount,is_redemption,account_email,game_name,games,app_users(full_name,customer_number,email)";
  const q = `purchases?select=${cols}&order=purchase_date.asc&limit=20000`;
  let rows;
  try {
    rows = await sbAll(q);
  } catch (err) {
    // Tolera que falten columnas de migraciones viejas (amount / is_redemption).
    if (/amount|is_redemption|does not exist/i.test(err.message || "")) {
      rows = await sbAll(q.replace(",amount", "").replace(",is_redemption", ""));
    } else {
      throw err;
    }
  }
  // Cuentas registradas (sin contraseña). null = falta la migración add_cuentas.sql.
  let cuentas = null;
  try {
    cuentas = await sbAll(`cuentas?select=id,plataforma,juego,correo,region,tipo,notas,created_at,costo_usd,fecha_compra&order=created_at.asc&limit=20000`);
  } catch (err) {
    if (costoMissing(err)) {
      // Falta add_cuenta_costo.sql: se listan igual, sin costo.
      cuentas = await sbAll(`cuentas?select=id,plataforma,juego,correo,region,tipo,notas,created_at&order=created_at.asc&limit=20000`);
    } else if (!ajustesMissing(err)) throw err;
  }
  // Bóveda de códigos: solo el resumen por cuenta (nunca los códigos).
  if (Array.isArray(cuentas) && cuentas.length) {
    try {
      const cods = await sbAll(`cuentas?select=id,codigos&codigos=not.is.null&limit=20000`);
      const porId = new Map(cods.map(c => [c.id, resumenBoveda(leerBoveda(c) || [])]));
      cuentas = cuentas.map(c => porId.has(c.id) ? { ...c, codigos_resumen: porId.get(c.id) } : c);
    } catch (err) {
      if (!codigosMissing(err)) throw err;
    }
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

// ===== Importar cuentas ANTERIORES (Excel del dueño, una sola vez) =====
// Carga cuentas de antes del sistema sin mezclarlas con las nuevas: cada una
// queda con "Origen: Excel" en notas (el panel las separa y no las cuenta en
// inversión/ganancia). Los cupos ya vendidos se registran como ventas del
// cliente "Ventas anteriores (Excel)" (se crea si no existe), fechadas
// 2025-12-31, con el texto del cliente del Excel en la nota. Contraseñas y
// códigos de verificación se guardan cifrados. Las cuentas cuyo correo ya
// está en cuentas o en ventas se saltean (no se duplica ni se pisa nada).
// dry_run: true → solo informa qué haría, sin guardar.
const EXCEL_CLIENTE_EMAIL = "ventas-anteriores@reymidascr.com";
const EXCEL_FECHA = "2025-12-31";
const EXCEL_SLOTS = {
  ps4: { platform: "PS4", modality: "principal" },
  ps5: { platform: "PS5", modality: "principal" },
};

async function importarExcel(req, res, body) {
  const staff = await requireStaff(req);
  const dry = body.dry_run !== false;
  // Sin la clave de cifrado (ACCOUNT_SECRET) las contraseñas quedarían en texto plano: no se importa.
  if (encryptSecret("prueba") === "prueba") return res.status(500).json({ error: "Falta ACCOUNT_SECRET en la app Node.js: no se importan contraseñas sin cifrar." });
  const lista = Array.isArray(body.cuentas) ? body.cuentas : [];
  if (!lista.length) return res.status(400).json({ error: "No vinieron cuentas" });
  if (lista.length > 500) return res.status(400).json({ error: "Máximo 500 cuentas por envío" });

  // Lo que ya existe (cuentas registradas y correos con ventas).
  let existentes;
  try {
    existentes = await sbAll(`cuentas?select=correo&limit=20000`);
  } catch (err) {
    if (ajustesMissing(err)) throw cuentasMissingError();
    throw err;
  }
  const ventasPrevias = await sbAll(`purchases?select=account_email&limit=20000`);
  const ya = new Set([...existentes.map(c => c.correo), ...ventasPrevias.map(v => v.account_email)]
    .map(e => String(e || "").trim().toLowerCase()).filter(Boolean));

  const problemas = [], saltadas = [], cuentas = [], ventas = [];
  const vistos = new Set();
  // Con la bóveda, los códigos van a la cuenta (libres) y no a una venta.
  let conBov = true;
  try { await bovedaDisponible(); } catch (err) { if (!codigosMissing(err)) throw err; conBov = false; }
  for (const [i, c] of lista.entries()) {
    const correo = String(c.correo || "").trim().toLowerCase();
    const juego = cleanText(c.juego, 200);
    const tipo = CUENTA_TIPOS.includes(c.tipo) ? c.tipo : "auto";
    if (!correo.includes("@") || !juego) { problemas.push(`#${i + 1}: falta correo o juego`); continue; }
    if (ya.has(correo)) { saltadas.push(correo); continue; }
    if (vistos.has(correo)) { problemas.push(`#${i + 1}: correo repetido en el Excel (${correo})`); continue; }
    vistos.add(correo);
    const juegos = (Array.isArray(c.juegos) ? c.juegos : []).map(j => cleanText(j, 150)).filter(Boolean);
    const notas = ["Origen: Excel (cuenta anterior)", c.bundle_id ? `Web: ${cleanText(c.bundle_id, 12)}` : "",
      juegos.length > 1 ? `Juegos: ${juegos.join(" | ")}` : ""].filter(Boolean).join(" · ").slice(0, 500);
    const pwd = cleanText(c.password, 200);
    cuentas.push({
      plataforma: "PlayStation", juego, correo, tipo,
      region: cleanText(c.region, 40), notas,
      password: pwd ? encryptSecret(pwd) : null,
      updated_at: new Date().toISOString(),
      // En una carga en lote todas las filas deben traer las mismas columnas.
      ...(conBov ? { codigos: parseCodigos(c.codigos).length
        ? encryptSecret(JSON.stringify({ v: 1, codigos: parseCodigos(c.codigos).map(x => ({ c: x, e: "libre" })) }))
        : null } : {}),
    });
    let codigosPuestos = conBov; // con bóveda, ninguna venta lleva códigos
    for (const v of Array.isArray(c.vendidos) ? c.vendidos : []) {
      const base = v.slot === "sec"
        ? { platform: /ps5/i.test(v.platform || "") ? "PS5" : "PS4", modality: "secundaria" }
        : EXCEL_SLOTS[v.slot];
      if (!base) { problemas.push(`${correo}: cupo desconocido "${v.slot}"`); continue; }
      ventas.push({
        purchase_date: EXCEL_FECHA, ...base,
        account_email: correo,
        account_password: encryptSecret(pwd || "-"),
        verifier_codes: !codigosPuestos && c.codigos ? encryptSecret(String(c.codigos).slice(0, 2000)) : null,
        games: juegos.length ? juegos.join("\n") : null,
        game_name: juego,
        notes: `Excel: ${cleanText(v.cliente, 200) || "(sin nombre)"}`,
      });
      if (c.codigos) codigosPuestos = true;
    }
    if (c.codigos && !codigosPuestos && !conBov) problemas.push(`${correo}: sin ventas, los códigos 2FA no se guardaron (no hay dónde)`);
  }

  // Cliente comodín para las ventas anteriores.
  let cliente = (await sb(`app_users?email=eq.${encodeURIComponent(EXCEL_CLIENTE_EMAIL)}&select=id,customer_number`))[0] || null;
  if (!dry && !cliente && ventas.length) {
    cliente = (await sb(`app_users`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      email: EXCEL_CLIENTE_EMAIL, full_name: "Ventas anteriores (Excel)", is_admin: false,
      password_hash: hashPassword(crypto.randomBytes(24).toString("hex")),
    }) }))[0];
  }

  if (!dry) {
    for (let k = 0; k < cuentas.length; k += 100) {
      try {
        await sb(`cuentas`, { method: "POST", body: JSON.stringify(cuentas.slice(k, k + 100)) });
      } catch (err) {
        if (ajustesMissing(err)) throw cuentasMissingError();
        throw err;
      }
    }
    const filas = ventas.map(v => ({ ...v, user_id: cliente.id }));
    for (let k = 0; k < filas.length; k += 100) {
      await sb(`purchases`, { method: "POST", body: JSON.stringify(filas.slice(k, k + 100)) });
    }
    invComboCache = { t: 0, data: null }; // que la tienda vea el inventario nuevo
    console.log(`[importar-excel] ${cuentas.length} cuentas y ${ventas.length} ventas anteriores (${staff.assistant ? "asistente " + staff.tid : "admin"})`);
  }
  res.status(200).json({
    dry_run: dry,
    cuentas_nuevas: cuentas.length,
    ventas_anteriores: ventas.length,
    ya_existian: saltadas.length,
    ya_existian_correos: saltadas,
    problemas,
    cliente: cliente ? { customer_number: cliente.customer_number } : "se crea al importar",
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
// Suscripciones: se venden aparte (página de Game Pass / PlayStation Plus).
const SUSCRIPCION_RE = /game\s*pass|ps\s*plus|playstation\s*plus|ea\s*play|ubisoft\s*\+|nintendo\s*switch\s*online|suscripci[oó]n|membres[ií]a|\b\d+\s*(meses|months?)\b/i;
let invComboCache = { t: 0, data: null };

// Cuenta enlazada a un bundle de la web ("Web: BPS005") o con lista de varios juegos.
const BUNDLE_CUENTA_RE = /\bWeb:\s*BPS\d/i;
// Título que ya dice que son varios juegos: "A + B", "Bundle 5X1", "Combo…", "Triple Pack".
// Juegos de una cuenta para Entrega inmediata. Un título "A + B" (cuenta de 2
// juegos) se ofrece bajo cada uno, igual que los de "Juegos: a | b" en notas.
// Los productos de la tienda con "Bundle" en el nombre ("… Cross-Gen Bundle",
// "Crash Bandicoot Bundle - N. Sane Trilogy + CTR") son UN producto: siguen
// apareciendo (antes un filtro por la palabra "bundle" los escondía).
function juegosDeCuenta(juego, notas, lista = []) {
  const out = [], vistos = new Set();
  const add = t => {
    const n = String(t || "").replace(/^\s*(combo|bundle|\d\s*x\s*1)\b[\s:-]*/i, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (n.length < 3 || /add-?on|\bdlc\b|upgrade|falta compra/i.test(n)) return;
    const k = n.toLowerCase();
    if (!vistos.has(k)) { vistos.add(k); out.push(n); }
  };
  const titulo = String(juego || "");
  if (/\+/.test(titulo)) titulo.split(/\s*\+\s*/).forEach(add); else add(titulo);
  const enNotas = (String(notas || "").match(/Juegos:\s*(.+)$/i) || [])[1];
  if (enNotas) enNotas.split("|").forEach(add);
  for (const j of lista) add(String(j).replace(/\s*\((game|full game)\)\s*$/i, ""));
  return out;
}

async function inventarioCombo(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  if (invComboCache.data && Date.now() - invComboCache.t < INV_COMBO_TTL_MS) {
    return res.status(200).json(invComboCache.data);
  }
  let cuentas = [];
  try {
    cuentas = await sbAll(`cuentas?select=plataforma,juego,correo,tipo,notas&limit=20000`);
  } catch (err) {
    if (!ajustesMissing(err)) throw err;
  }
  const ventas = await sbAll(`purchases?select=platform,modality,account_email,game_name,games&limit=20000`);
  const acc = new Map(); // correo → { fam, juego, tipo, usados }
  const key = e => String(e || "").trim().toLowerCase();
  for (const c of cuentas) {
    if (!key(c.correo)) continue;
    acc.set(key(c.correo), { fam: c.plataforma, juego: c.juego, notas: c.notas, tipo: c.tipo, bundle: BUNDLE_CUENTA_RE.test(c.notas || ""), ps4: 0, ps5: 0, pri: 0, sec: 0, full: false });
  }
  for (const v of ventas) {
    const k = key(v.account_email);
    if (!k) continue;
    const plat = String(v.platform || "");
    const fam = /xbox/i.test(plat) ? "Xbox" : /nintendo|switch/i.test(plat) ? "Nintendo" : "PlayStation";
    if (!acc.has(k)) acc.set(k, { fam, juego: v.game_name, tipo: "auto", ps4: 0, ps5: 0, pri: 0, sec: 0, full: false });
    const a = acc.get(k);
    if (!a.juego && v.game_name) a.juego = v.game_name;
    // Lista de juegos de la venta (cuentas de 2 juegos cargadas a mano, ej. "Call of Duty Bundle 2x1").
    if (v.games) a.lista = [...new Set([...(a.lista || []), ...String(v.games).split("\n").map(x => x.trim()).filter(Boolean)])].slice(0, 12);
    const mod = String(v.modality || "").toLowerCase();
    if (mod === "individual" || mod === "bundle") a.full = true;
    else if (mod.startsWith("secund")) a.sec++; // la secundaria no ocupa primarias
    else if (fam === "PlayStation") { if (/ps5/i.test(plat)) a.ps5++; else if (/ps4/i.test(plat)) a.ps4++; }
    else a.pri++;
  }
  const juegos = new Map();
  for (const a of acc.values()) {
    if (a.full || !a.juego || a.fam === "Nintendo") continue;
    if (SUSCRIPCION_RE.test(a.juego)) continue; // Game Pass, PS Plus…: no son juegos para entrega inmediata
    // Cuentas enlazadas a un bundle de la web (/bundles/PS): se venden como bundle.
    if (a.bundle) continue;
    // La secundaria se vende DESPUÉS de las principales (regla del dueño,
    // 22/11/2026): en PlayStation, la de una consola solo se ofrece cuando las
    // 2 principales de esa consola ya están vendidas; en Xbox, el Segundo plano
    // después de la Principal.
    let libres;
    const secLibre = Math.max(0, 1 - a.sec); // secundaria: 1 por cuenta
    if (a.fam === "Xbox") {
      libres = { xbox: Math.max(0, 1 - a.pri) }; // Xbox: Principal + Segundo plano
      libres.sec = libres.xbox ? 0 : secLibre;
    } else {
      const l4 = a.tipo === "ps5only" ? 0 : Math.max(0, 2 - a.ps4);
      const l5 = Math.max(0, 2 - a.ps5);
      libres = a.tipo === "ps5only" ? { ps5: l5 } : { ps4: l4, ps5: l5 };
      libres.sec_ps4 = a.tipo !== "ps5only" && !l4 ? secLibre : 0;
      libres.sec_ps5 = !l5 ? secLibre : 0;
      libres.sec = libres.sec_ps4 || libres.sec_ps5 ? secLibre : 0;
    }
    if (!Object.values(libres).some(n => n > 0)) continue;
    for (const nombre of juegosDeCuenta(a.juego, a.notas, a.lista)) {
      const k = nombre.toLowerCase();
      const j = juegos.get(k) || { juego: nombre, plataforma: a.fam, ps4: 0, ps5: 0, xbox: 0, sec: 0, sec_ps4: 0, sec_ps5: 0 };
      for (const [c, n] of Object.entries(libres)) j[c] += n;
      juegos.set(k, j);
    }
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

// ===== Bóveda de códigos de verificación (api/_codigos.js) =====
// Cuenta + bóveda lista para leer o modificar (sembrada la primera vez).
async function bovedaDe(email) {
  await bovedaDisponible();
  const cuenta = await cuentaByEmail(email);
  if (!cuenta) return null;
  let lista = leerBoveda(cuenta), recortes = [];
  if (!lista) ({ lista, recortes } = sembrarDesdeVentas(await ventasDeCuenta(email)));
  return { cuenta, lista, recortes };
}
async function conBoveda(fn) {
  try { return await fn(); } catch (err) { if (codigosMissing(err)) throw codigosMissingError(); throw err; }
}

// Solo admin: todos los códigos de una cuenta con su estado.
async function codigosCuenta(req, res, body) {
  await requireAdmin(req);
  const email = String(body.account_email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Correo de la cuenta requerido" });
  return conBoveda(async () => {
    const b = await bovedaDe(email);
    if (!b) return res.status(200).json({ registrada: false, codigos: [], resumen: resumenBoveda([]) });
    res.status(200).json({ registrada: true, codigos: b.lista, resumen: resumenBoveda(b.lista) });
  });
}

// Solo admin: carga un set de códigos. modo "reemplazar" (set nuevo de Sony:
// los viejos quedan anulados) o "agregar".
async function codigosGuardar(req, res, body) {
  await requireAdmin(req);
  const email = String(body.account_email || "").trim().toLowerCase();
  const nuevos = parseCodigos(body.codigos);
  if (!email) return res.status(400).json({ error: "Correo de la cuenta requerido" });
  if (!nuevos.length) return res.status(400).json({ error: "No vinieron códigos válidos (uno por línea)." });
  return conBoveda(async () => {
    const b = await bovedaDe(email);
    if (!b) return res.status(404).json({ error: "Esa cuenta no está registrada: registrala primero en Cuentas." });
    const { agregados, reasignadas } = cargarSet(b.lista, nuevos, body.modo === "agregar" ? "agregar" : "reemplazar");
    await guardarBoveda(b.cuenta.id, b.lista);
    await aplicarRecortes(b.recortes);
    await sincronizarVentas(reasignadas, b.lista);
    res.status(200).json({
      ok: true, agregados, resumen: resumenBoveda(b.lista),
      clientes_actualizados: reasignadas.filter(r => r.dados).length,
      clientes_sin_codigos: reasignadas.filter(r => r.faltan).length,
    });
  });
}

// Admin o asistente: entrega N códigos libres más a una venta (el cliente los
// ve en su compra). No devuelve los códigos: el asistente nunca los ve.
async function codigosEntregar(req, res, body) {
  const staff = await requireStaff(req);
  const id = String(body.purchase_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Venta inválida" });
  const n = Math.max(1, Math.min(3, parseInt(body.n ?? 1, 10) || 1));
  return conBoveda(async () => {
    const v = (await sb(`purchases?id=eq.${id}&select=id,account_email,verifier_codes,app_users(customer_number)`))[0];
    if (!v) return res.status(404).json({ error: "Esa venta ya no existe" });
    const b = await bovedaDe(String(v.account_email || "").trim().toLowerCase());
    if (!b) return res.status(404).json({ error: "La cuenta de esa venta no está registrada." });
    const dados = asignar(b.lista, n, { venta: id, rm: v.app_users?.customer_number });
    if (!dados.length) return res.status(409).json({ error: "Esa cuenta no tiene códigos libres: generá un set nuevo en Sony y cargalo en la cuenta.", resumen: resumenBoveda(b.lista) });
    await guardarBoveda(b.cuenta.id, b.lista);
    await aplicarRecortes(b.recortes.filter(r => r.venta !== id));
    // Si la venta estaba entre los recortes, parte de lo que le quedó.
    const base = b.recortes.find(r => r.venta === id)?.codigos ?? parseCodigos(decryptSecret(v.verifier_codes) || "");
    await sb(`purchases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ verifier_codes: encryptSecret([...base, ...dados].join("\n")) }) });
    // Al admin se le devuelven para mostrarlos; al asistente no.
    res.status(200).json({ ok: true, entregados: dados.length, ...(staff.admin ? { codigos: dados } : {}), resumen: resumenBoveda(b.lista) });
  });
}

// Cliente: "Ya lo usé". Los códigos de Sony sirven UNA vez: el usado sale de
// su compra y recibe otro libre (hasta TOPE_POR_VENTA en total). Devuelve la
// lista nueva de SUS códigos, que el cliente ya tiene derecho a ver.
async function codigoUsado(req, res, body) {
  const user = await requireAuth(req);
  const id = String(body.purchase_id || "");
  const codigo = String(body.codigo || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9-]{4,20}$/.test(codigo)) return res.status(400).json({ error: "Datos inválidos" });
  const v = (await sb(`purchases?id=eq.${id}&user_id=eq.${user.id}&select=id,account_email,verifier_codes,app_users(customer_number)`))[0];
  if (!v) return res.status(404).json({ error: "No encontramos esa compra." });
  const actuales = parseCodigos(decryptSecret(v.verifier_codes) || "");
  if (!actuales.includes(codigo)) return res.status(404).json({ error: "Ese código ya no está en tu compra. Recargá la página." });
  return conBoveda(async () => {
    const b = await bovedaDe(String(v.account_email || "").trim().toLowerCase());
    let r = { ok: false, repuestos: 0, motivo: null };
    if (b) {
      await aplicarRecortes(b.recortes);
      r = reponerUsado(b.lista, codigo, id, v.app_users?.customer_number);
      if (r.ok) await guardarBoveda(b.cuenta.id, b.lista);
    }
    // Sin bóveda (o código que la bóveda no conoce): solo sale de la compra.
    const lista = b?.lista || [];
    const base = b?.recortes.find(x => x.venta === id)?.codigos ?? actuales;
    const cods = codigosDeVenta(base.filter(c => c !== codigo).join("\n"), lista, id);
    await sb(`purchases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ verifier_codes: cods.length ? encryptSecret(cods.join("\n")) : null }) });
    console.log(`[codigos] venta ${id}: usado 1, repuestos ${r.repuestos}${r.motivo ? ` (${r.motivo})` : ""}`);
    res.status(200).json({ ok: true, codigos: cods, repuestos: r.repuestos, motivo: r.motivo, tope: TOPE_POR_VENTA });
  });
}

// Admin: marcar un código como usado (y reponer) o deshacerlo (vuelve a la
// venta que lo tenía).
async function codigosMarcar(req, res, body) {
  await requireAdmin(req);
  const email = String(body.account_email || "").trim().toLowerCase();
  const codigo = String(body.codigo || "").trim();
  if (!email || !codigo) return res.status(400).json({ error: "Faltan la cuenta o el código" });
  return conBoveda(async () => {
    const b = await bovedaDe(email);
    if (!b) return res.status(404).json({ error: "Esa cuenta no está registrada." });
    const x = b.lista.find(y => y.c === codigo);
    if (!x?.venta) return res.status(404).json({ error: "Ese código no está entregado a ninguna venta." });
    let r = { ok: false };
    if (body.estado === "usado") r = reponerUsado(b.lista, codigo, x.venta, x.rm);
    else if (body.estado === "entregado") r = { ok: desmarcarUsado(b.lista, codigo) };
    if (!r.ok) return res.status(409).json({ error: "Ese código no se puede cambiar a ese estado." });
    await guardarBoveda(b.cuenta.id, b.lista);
    await aplicarRecortes(b.recortes);
    await sincronizarVentas([{ venta: x.venta }], b.lista);
    res.status(200).json({ ok: true, repuestos: r.repuestos || 0, motivo: r.motivo || null, codigos: b.lista, resumen: resumenBoveda(b.lista) });
  });
}

// Una sola vez: arma la bóveda de todas las cuentas registradas con los
// códigos que hoy están en sus ventas. dry_run (por defecto) solo cuenta.
// No devuelve códigos.
async function codigosMigrar(req, res, body) {
  await requireStaff(req);
  const dry = body.dry_run !== false;
  return conBoveda(async () => {
    await bovedaDisponible();
    const cuentas = await sbAll(`cuentas?select=id,correo,codigos&limit=20000`);
    const ventas = await sbAll(`purchases?select=id,account_email,purchase_date,created_at,verifier_codes,app_users(email,customer_number)&verifier_codes=not.is.null&order=created_at.asc&limit=20000`);
    const porCuenta = new Map();
    for (const v of ventas) {
      const k = String(v.account_email || "").trim().toLowerCase();
      if (!porCuenta.has(k)) porCuenta.set(k, []);
      porCuenta.get(k).push(v);
    }
    const t = { cuentas: 0, ya_tenian: 0, sin_codigos: 0, libres: 0, entregados: 0, expuestos: 0, ventas_recortadas: 0, cuentas_sin_libres: 0 };
    for (const c of cuentas) {
      if (c.codigos) { t.ya_tenian++; continue; }
      const vs = porCuenta.get(String(c.correo || "").trim().toLowerCase()) || [];
      const { lista, recortes } = sembrarDesdeVentas(vs);
      if (!lista.length) { t.sin_codigos++; continue; }
      const r = resumenBoveda(lista);
      t.cuentas++; t.libres += r.libres; t.entregados += r.entregados; t.expuestos += r.expuestos;
      t.ventas_recortadas += recortes.length;
      if (!r.libres) t.cuentas_sin_libres++;
      if (!dry) {
        await guardarBoveda(c.id, lista);
        await aplicarRecortes(recortes);
      }
    }
    const sinRegistrar = [...porCuenta.keys()].filter(k => !cuentas.some(c => String(c.correo || "").trim().toLowerCase() === k)).length;
    res.status(200).json({ dry_run: dry, ...t, cuentas_con_codigos_sin_registrar: sinRegistrar });
  });
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
  // Con el correo comodín activo no se crea buzón: el correo llega igual y
  // se lee desde el comodín (no hace falta entrar a cPanel).
  const comodin = body.crear_correo !== false && catchAllActivo();
  const crearCorreo = body.crear_correo !== false && !comodin;
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
  res.status(200).json({ ok: true, correo, correo_creado: crearCorreo, ...(comodin ? { correo_por_comodin: `${CATCHALL_LOCAL}@${MAIL_DOMAIN}` } : {}) });
}

// Últimos correos de PlayStation de un buzón @reymidascr.com: código o enlace
// de verificación. Solo mensajes de Sony de los últimos 7 días.
async function correoLeer(req, res, body) {
  await requireStaff(req);
  const local = cleanLocal(body.correo);
  if (!local) return res.status(400).json({ error: `Solo se pueden leer correos @${MAIL_DOMAIN}.` });
  const r = readSonyMail(local);
  if (!r.exists) return res.status(404).json({ error: `No encontré el buzón ${local}@${MAIL_DOMAIN} en el hosting (ni el correo comodín ${CATCHALL_LOCAL}@${MAIL_DOMAIN}).` });
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
