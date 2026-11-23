// Ranking de embajadores (migrations/add_ranking.sql): reglas y registro de
// puntos. Lo usan api/ranking.js (visitas, tabla, panel), api/auth.js
// (registro de un invitado) y api/purchases.js (compra de un invitado).
import crypto from "crypto";
import { sb } from "./_lib.js";

export const PUNTOS = { visita: 1, registro: 10, compra: 50 };
export const TOPE_VISITAS_DIA = 30;      // puntos por visitas que un embajador suma por día
export const MINIMO_PARA_GANAR = 30;     // puntos del mes para entrar al podio
export const NIVELES = [
  { nombre: "Rey Midas", desde: 300 },
  { nombre: "Oro", desde: 150 },
  { nombre: "Plata", desde: 50 },
  { nombre: "Bronce", desde: 10 },
];
export const PREMIOS = [
  "Un bundle a elegir de la lista de Bundles",
  "Un juego a elegir de Entrega inmediata",
  "1 mes de TV por streaming",
];

export function nivelDe(puntos) {
  return NIVELES.find(n => puntos >= n.desde)?.nombre || "Recluta";
}

// Mes del ranking en hora de Costa Rica (UTC−6): "2026-11".
export function mesDe(fecha = new Date()) {
  const d = new Date(new Date(fecha).getTime() - 6 * 3600 * 1000);
  return d.toISOString().slice(0, 7);
}

// "RM-0083", "rm0083", "83" → 83
export function numeroDeCodigo(codigo) {
  const n = parseInt(String(codigo || "").replace(/^\s*rm[-\s]*/i, "").replace(/\D/g, ""), 10);
  return n > 0 && n < 10000000 ? n : 0;
}
export function codigoDe(n) {
  return n ? `RM${String(n).padStart(4, "0")}` : "";
}

// La tabla todavía no existe (migración sin correr): el resto del sitio sigue.
export function rankingMissing(err) {
  const t = `${err?.message || ""} ${err?.data?.message || ""} ${err?.data?.code || ""}`;
  return /ranking_eventos|referido_por/i.test(t) && /does not exist|could not find|PGRST20[45]|42P01|42703/i.test(t);
}

export async function usuarioPorCodigo(codigo) {
  const n = numeroDeCodigo(codigo);
  if (!n) return null;
  return (await sb(`app_users?customer_number=eq.${n}&select=id,customer_number,full_name`))[0] || null;
}

// Huella anónima de quien abre el enlace: no se guarda la IP.
export function huella(ip, dispositivo) {
  const sal = process.env.AUTH_SECRET || process.env.ACCOUNT_SECRET || "rey-midas";
  return crypto.createHash("sha256").update(`${sal}|${ip}|${dispositivo || ""}`).digest("hex").slice(0, 32);
}

// Un cliente nuevo se registró con el código (o el enlace) de otro: +10 al que
// invitó. Nunca rompe el registro: ante cualquier problema, se omite.
export async function registrarInvitado(nuevo, codigo) {
  try {
    const ref = await usuarioPorCodigo(codigo);
    if (!ref || ref.id === nuevo.id) return false;
    await sb(`app_users?id=eq.${nuevo.id}`, { method: "PATCH", body: JSON.stringify({ referido_por: ref.id }) });
    await sb(`ranking_eventos`, { method: "POST", body: JSON.stringify({
      ref_user_id: ref.id, tipo: "registro", puntos: PUNTOS.registro, mes: mesDe(), user_id: nuevo.id,
    }) });
    return true;
  } catch (err) {
    if (!rankingMissing(err) && err?.data?.code !== "23505") console.error("[ranking] registro:", err.message);
    return false;
  }
}

// Venta a un cliente invitado: +50 al que lo invitó (una vez por venta). Los
// canjes del Cofre de Oro no cuentan. Nunca rompe la venta.
export async function registrarCompra({ purchaseId, userId, esCanje }) {
  if (!purchaseId || !userId || esCanje) return false;
  try {
    const u = (await sb(`app_users?id=eq.${userId}&select=id,referido_por`))[0];
    if (!u?.referido_por || u.referido_por === userId) return false;
    await sb(`ranking_eventos`, { method: "POST", body: JSON.stringify({
      ref_user_id: u.referido_por, tipo: "compra", puntos: PUNTOS.compra, mes: mesDe(), user_id: userId, purchase_id: purchaseId,
    }) });
    return true;
  } catch (err) {
    if (!rankingMissing(err) && err?.data?.code !== "23505") console.error("[ranking] compra:", err.message);
    return false;
  }
}
