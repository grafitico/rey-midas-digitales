// Bóveda de códigos de verificación (2FA) por cuenta — migrations/add_cuenta_codigos.sql
//
// Todos los códigos de una cuenta viven una sola vez en cuentas.codigos, como
// un JSON cifrado (ACCOUNT_SECRET). Cada venta recibe pocos códigos (2 por
// defecto) y el cliente ve solo esos en "Mis compras". Estados de cada código:
//   libre      → se puede entregar
//   entregado  → se le dio a una venta (venta, rm, fecha) y sigue sirviendo
//   usado      → el cliente (o el admin) avisó que ya lo usó: Sony los
//                acepta UNA sola vez, así que sale de su compra y, si no
//                pasó el tope, le llega otro libre (reponerUsado)
//   expuesto   → un cliente lo vio antes de la bóveda (cuando se le copiaban
//                todos): no se vuelve a entregar
//   anulado    → Sony lo invalidó al generar un set nuevo (los que tenían
//                los clientes también: cargarSet les da los nuevos)
import { sb, encryptSecret, decryptSecret } from "./_lib.js";

export const CODIGOS_POR_VENTA = 2;
// Máximo de códigos que una venta recibe en total (los 2 iniciales + los que
// se reponen al marcar "Ya lo usé"). Pasado el tope, el cliente escribe por
// WhatsApp: así nadie vacía la bóveda que comparten las 5 ventas de la cuenta.
export const TOPE_POR_VENTA = 5;
export const CLIENTE_EXCEL_EMAIL = "ventas-anteriores@reymidascr.com";

// La columna todavía no existe (migración sin correr).
export function codigosMissing(err) {
  const t = `${err?.message || ""} ${err?.data?.message || ""} ${err?.data?.code || ""}`;
  return /codigos/i.test(t) && /does not exist|could not find|PGRST204|42703/i.test(t);
}
export function codigosMissingError() {
  const e = new Error("Falta la bóveda de códigos: corré migrations/add_cuenta_codigos.sql en Supabase (SQL Editor → New query → Run).");
  e.status = 409;
  return e;
}

// Texto libre → códigos (uno por línea, o separados por espacios/comas).
// Sony da códigos alfanuméricos de 6 a 8; se toleran de 4 a 20. Un código
// puede NO tener números (ABCDEF, abcd-efgh): se acepta si tiene 6 o más
// caracteres y es todo mayúsculas o todo minúsculas (así no entran palabras
// como "Backup" o "PlayStation"). Antes del 25/11/2026 se exigía un número
// y los códigos solo con letras se perdían en silencio.
const PALABRAS = new Set(["backup", "codes", "codigos", "code", "codigo", "playstation", "verificacion", "respaldo", "copiar", "imprimir", "descargar", "download", "print", "copy"]);
function pareceCodigo(c) {
  if (!/^[A-Za-z0-9-]{4,20}$/.test(c) || !/[A-Za-z0-9]/.test(c)) return false;
  if (/\d/.test(c)) return !/^\d{1,2}[.)]?$/.test(c);
  const letras = c.replace(/-/g, "");
  return letras.length >= 6 && (letras === letras.toUpperCase() || letras === letras.toLowerCase()) && !PALABRAS.has(letras.toLowerCase());
}
export function parseCodigosDetalle(texto) {
  const codigos = [], ignorados = [];
  for (const t of String(texto || "").split(/[\s,;|]+/)) {
    const c = t.trim().replace(/^[-•*·]+/, "").replace(/[.)]+$/, "");
    if (!c) continue;
    if (/^\d{1,2}$/.test(c)) continue; // numeración "1." "2)"
    if (pareceCodigo(c)) { if (!codigos.includes(c)) codigos.push(c); }
    else if (!ignorados.includes(t.trim())) ignorados.push(t.trim());
  }
  return { codigos, ignorados };
}
export const parseCodigos = (texto) => parseCodigosDetalle(texto).codigos;

// cuentas.codigos → lista, o null si la cuenta todavía no tiene bóveda.
export function leerBoveda(cuenta) {
  if (!cuenta?.codigos) return null;
  try {
    const d = JSON.parse(decryptSecret(cuenta.codigos));
    return Array.isArray(d?.codigos) ? d.codigos : null;
  } catch {
    return null;
  }
}

export function resumenBoveda(lista) {
  const r = { libres: 0, entregados: 0, usados: 0, expuestos: 0, anulados: 0, total: 0 };
  for (const x of lista || []) {
    r.total++;
    if (x.e === "libre") r.libres++;
    else if (x.e === "entregado") r.entregados++;
    else if (x.e === "usado") r.usados++;
    else if (x.e === "expuesto") r.expuestos++;
    else if (x.e === "anulado") r.anulados++;
  }
  return r;
}

export async function guardarBoveda(cuentaId, lista) {
  await sb(`cuentas?id=eq.${cuentaId}`, {
    method: "PATCH",
    body: JSON.stringify({ codigos: encryptSecret(JSON.stringify({ v: 1, codigos: lista })), updated_at: new Date().toISOString() }),
  });
}

function hoy() { return new Date().toISOString().slice(0, 10); }

// Entrega n códigos libres a una venta (en orden). Devuelve los entregados.
export function asignar(lista, n, { venta, rm }) {
  const dados = [];
  for (const x of lista) {
    if (dados.length >= n) break;
    if (x.e !== "libre") continue;
    Object.assign(x, { e: "entregado", venta, rm: rm || null, f: hoy() });
    dados.push(x.c);
  }
  return dados;
}

// Set nuevo de Sony: TODOS los códigos viejos que no se usaron quedan
// anulados (Sony los invalida), también los que tenían los clientes, y los
// nuevos entran como libres. A cada venta que se quedó sin sus códigos se le
// entregan otros tantos del set nuevo (reasignadas: hay que actualizar esas
// ventas con codigosDeVenta). Con modo "agregar" solo suma los nuevos.
export function cargarSet(lista, codigos, modo = "reemplazar") {
  const ya = new Set(lista.map(x => x.c));
  const nuevos = codigos.filter(c => !ya.has(c));
  const enSet = new Set(codigos);
  const perdidas = new Map(); // venta → { n, rm }
  if (modo === "reemplazar" && nuevos.length) {
    for (const x of lista) {
      // Los que vienen otra vez en el set pegado siguen valiendo (Sony los
      // sigue mostrando): no se anulan.
      if (enSet.has(x.c)) { if (x.e === "anulado") x.e = "libre"; continue; }
      if (x.e === "entregado" && x.venta) {
        const p = perdidas.get(x.venta) || { n: 0, rm: x.rm || null };
        p.n++;
        perdidas.set(x.venta, p);
      }
      if (x.e === "libre" || x.e === "expuesto" || x.e === "entregado") Object.assign(x, { e: "anulado", f: hoy() });
    }
  }
  for (const c of nuevos) lista.push({ c, e: "libre" });
  const reasignadas = [];
  for (const [venta, { n, rm }] of perdidas) {
    const dados = asignar(lista, n, { venta, rm });
    reasignadas.push({ venta, dados: dados.length, faltan: n - dados.length });
  }
  return { agregados: nuevos.length, repetidos: codigos.length - nuevos.length, reasignadas };
}

// Códigos que una venta tiene vigentes en la bóveda (los que el cliente ve).
export const vigentesDe = (lista, venta) => lista.filter(x => x.e === "entregado" && x.venta === venta).map(x => x.c);
// Cuántos recibió en total (vigentes + usados), para el tope.
export const recibidosDe = (lista, venta) => lista.filter(x => (x.e === "entregado" || x.e === "usado") && x.venta === venta).length;

// Lo que la venta debe mostrar: sus vigentes de la bóveda, más los que tenga
// de antes que la bóveda no conoce (cuentas sin bóveda completa).
export function codigosDeVenta(actuales, lista, venta) {
  const enBoveda = new Set(lista.map(x => x.c));
  return [...parseCodigos(actuales).filter(c => !enBoveda.has(c)), ...vigentesDe(lista, venta)];
}

// "Ya lo usé": el código sale de la venta y, si la venta tiene menos de
// CODIGOS_POR_VENTA vigentes y no llegó al TOPE_POR_VENTA, recibe uno libre.
// Devuelve { ok, repuestos, motivo } (motivo: "tope" | "sin-libres" | null).
export function reponerUsado(lista, codigo, venta, rm) {
  const x = lista.find(y => y.c === codigo && y.venta === venta && y.e === "entregado");
  if (!x) return { ok: false };
  Object.assign(x, { e: "usado", fu: hoy() });
  const faltan = Math.max(0, CODIGOS_POR_VENTA - vigentesDe(lista, venta).length);
  const cupo = Math.max(0, TOPE_POR_VENTA - recibidosDe(lista, venta));
  const pedir = Math.min(faltan, cupo);
  const dados = pedir ? asignar(lista, pedir, { venta, rm }) : [];
  const motivo = faltan && !cupo ? "tope" : faltan && dados.length < pedir ? "sin-libres" : null;
  return { ok: true, repuestos: dados.length, motivo };
}

// Admin: corregir un error ("lo marqué usado sin querer"): vuelve a entregado.
export function desmarcarUsado(lista, codigo) {
  const x = lista.find(y => y.c === codigo && y.e === "usado");
  if (!x) return false;
  x.e = "entregado";
  delete x.fu;
  return true;
}

// Ventas de una cuenta (todas), con el cliente: para sembrar la bóveda.
export async function ventasDeCuenta(email) {
  const pat = encodeURIComponent("*" + email.replace(/[\\%_]/g, m => "\\" + m) + "*");
  const rows = await sb(`purchases?account_email=ilike.${pat}&select=id,account_email,purchase_date,created_at,verifier_codes,app_users(email,customer_number)&order=created_at.asc&limit=200`);
  return rows.filter(r => String(r.account_email || "").trim().toLowerCase() === email);
}

// Primera vez: arma la bóveda con los códigos que hoy están en las ventas.
//  - Ventas de "Ventas anteriores (Excel)" (no es un cliente real) → libres.
//  - Ventas de clientes reales → los 2 primeros quedan entregados a esa venta
//    (el cliente sigue viéndolos) y el resto "expuesto": el cliente los vio
//    cuando se copiaban todos, así que no se le dan a otro. La venta se
//    recorta a esos 2 (recortes).
export function sembrarDesdeVentas(ventas, n = CODIGOS_POR_VENTA) {
  const lista = [], visto = new Set(), recortes = [];
  for (const v of ventas) {
    const cods = parseCodigos(decryptSecret(v.verifier_codes) || "");
    if (!cods.length) continue;
    const real = v.app_users && String(v.app_users.email || "").toLowerCase() !== CLIENTE_EXCEL_EMAIL;
    const nuevos = cods.filter(c => !visto.has(c));
    if (!real) {
      for (const c of nuevos) { visto.add(c); lista.push({ c, e: "libre" }); }
      recortes.push({ venta: v.id, codigos: [] }); // pasan a la bóveda: la venta comodín queda sin códigos
      continue;
    }
    const quedan = [];
    for (const c of cods) {
      if (quedan.length < n && !lista.some(x => x.c === c && x.e === "entregado")) {
        quedan.push(c);
        const ya = lista.find(x => x.c === c);
        const dato = { e: "entregado", venta: v.id, rm: v.app_users.customer_number || null, f: String(v.purchase_date || "").slice(0, 10) || null };
        if (ya) Object.assign(ya, dato); else { lista.push({ c, ...dato }); visto.add(c); }
      } else if (!visto.has(c)) {
        visto.add(c);
        lista.push({ c, e: "expuesto", venta: v.id, rm: v.app_users.customer_number || null });
      } else {
        const ya = lista.find(x => x.c === c);
        if (ya && ya.e === "libre") Object.assign(ya, { e: "expuesto", venta: v.id, rm: v.app_users.customer_number || null });
      }
    }
    if (quedan.length < cods.length) recortes.push({ venta: v.id, codigos: quedan });
  }
  return { lista, recortes };
}
