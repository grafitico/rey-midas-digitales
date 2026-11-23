// Ranking de embajadores (ver api/_ranking.js y migrations/add_ranking.sql).
//
// POST /api/ranking
//   { action: "visita", r: "RM0083", ruta, vid }  público: alguien abrió un enlace con ?r=
//   { action: "tabla", mes? }                     público: top 10 del mes (solo nombre corto)
//   { action: "mio" }                             cliente con sesión: su puntaje y su enlace
//   { action: "admin", mes? }                     admin: detalle por embajador
//   { action: "anular", ref_user_id, mes, tipo? } admin: anula puntos (no los borra)
import { sb, sbAll, requireAuth, requireAdmin, handleError, readJson, checkConfig, clientIp, createRateLimiter, verifyToken, parseCookies } from "./_lib.js";
import { BOT_RE } from "../middleware.js";
import {
  PUNTOS, TOPE_VISITAS_DIA, MINIMO_PARA_GANAR, NIVELES, PREMIOS, nivelDe, mesDe, codigoDe,
  usuarioPorCodigo, huella, rankingMissing,
} from "./_ranking.js";

const limiteVisitas = createRateLimiter({ perMinute: 20, perHour: 200, globalPerHour: 20000 });
const MES_RE = /^\d{4}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    checkConfig();
    const body = await readJson(req);
    if (body.action === "visita") return await visita(req, res, body);
    if (body.action === "tabla") return await tabla(req, res, body);
    if (body.action === "mio") return await mio(req, res);
    if (body.action === "admin") return await admin(req, res, body);
    if (body.action === "anular") return await anular(req, res, body);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    if (rankingMissing(err)) return res.status(503).json({ error: "El ranking todavía no está activo (falta migrations/add_ranking.sql)." });
    handleError(res, err);
  }
}

function sesionDe(req) {
  const tok = parseCookies(req).rmd_session || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyToken(tok)?.sub || null;
}

// Alguien abrió un enlace con ?r=: +1 al embajador si es una persona nueva.
// No cuenta: robots, el propio embajador, la misma persona dentro de 24 h, ni
// más de TOPE_VISITAS_DIA por día. Siempre responde ok (no da pistas).
async function visita(req, res, body) {
  const ok = () => res.status(200).json({ ok: true });
  const ua = String(req.headers["user-agent"] || "");
  if (!ua || BOT_RE.test(ua) || /bot|crawl|spider|headless|preview/i.test(ua)) return ok();
  const ip = clientIp(req);
  if (limiteVisitas(ip)) return ok();
  const ref = await usuarioPorCodigo(body.r);
  if (!ref) return ok();
  if (sesionDe(req) === ref.id) return ok(); // el embajador abriendo su propio enlace
  const quien = huella(ip, String(body.vid || "").slice(0, 64));
  const hace24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const repetida = await sb(`ranking_eventos?ref_user_id=eq.${ref.id}&tipo=eq.visita&visitante=eq.${quien}&created_at=gte.${hace24}&select=id&limit=1`);
  if (repetida.length) return ok();
  const hoy = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10); // día en Costa Rica
  const desde = new Date(`${hoy}T06:00:00Z`).toISOString();
  const deHoy = await sb(`ranking_eventos?ref_user_id=eq.${ref.id}&tipo=eq.visita&created_at=gte.${desde}&select=id&limit=${TOPE_VISITAS_DIA}`);
  if (deHoy.length >= TOPE_VISITAS_DIA) return ok();
  await sb(`ranking_eventos`, { method: "POST", body: JSON.stringify({
    ref_user_id: ref.id, tipo: "visita", puntos: PUNTOS.visita, mes: mesDe(), visitante: quien,
    ruta: String(body.ruta || "").slice(0, 160),
  }) });
  return ok();
}

// Nombre corto para mostrar en público: "Jhon S."
function alias(nombre, numero) {
  const p = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return `Jugador ${codigoDe(numero).slice(-4)}`;
  const nom = p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase();
  return p[1] ? `${nom} ${p[1].charAt(0).toUpperCase()}.` : nom;
}

async function sumarMes(mes) {
  const ev = await sbAll(`ranking_eventos?mes=eq.${mes}&anulado=eq.false&select=ref_user_id,tipo,puntos&limit=100000`);
  const por = new Map();
  for (const e of ev) {
    const t = por.get(e.ref_user_id) || { id: e.ref_user_id, puntos: 0, visita: 0, registro: 0, compra: 0 };
    t.puntos += e.puntos; t[e.tipo] = (t[e.tipo] || 0) + 1;
    por.set(e.ref_user_id, t);
  }
  return [...por.values()].sort((a, b) => b.puntos - a.puntos || b.compra - a.compra || b.registro - a.registro);
}
async function nombres(ids) {
  if (!ids.length) return new Map();
  const us = await sb(`app_users?id=in.(${ids.join(",")})&select=id,full_name,customer_number,email`);
  return new Map(us.map(u => [u.id, u]));
}
function mesAnterior(mes) {
  const [y, m] = mes.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

let cacheTabla = { t: 0, mes: "", data: null };
async function tabla(req, res, body) {
  const mes = MES_RE.test(String(body.mes || "")) ? body.mes : mesDe();
  res.setHeader("Cache-Control", "no-store");
  if (cacheTabla.data && cacheTabla.mes === mes && Date.now() - cacheTabla.t < 60000) return res.status(200).json(cacheTabla.data);
  const filas = (await sumarMes(mes)).slice(0, 10);
  const prev = (await sumarMes(mesAnterior(mes))).filter(f => f.puntos >= MINIMO_PARA_GANAR).slice(0, 3);
  const n = await nombres([...filas, ...prev].map(f => f.id));
  const publico = f => ({ alias: alias(n.get(f.id)?.full_name, n.get(f.id)?.customer_number), puntos: f.puntos, nivel: nivelDe(f.puntos), compras: f.compra, registros: f.registro });
  const data = {
    mes, top: filas.map(publico), ganadores_mes_anterior: prev.map(publico), mes_anterior: mesAnterior(mes),
    reglas: { puntos: PUNTOS, tope_visitas_dia: TOPE_VISITAS_DIA, minimo: MINIMO_PARA_GANAR, niveles: NIVELES, premios: PREMIOS },
  };
  cacheTabla = { t: Date.now(), mes, data };
  res.status(200).json(data);
}

async function mio(req, res) {
  const user = await requireAuth(req);
  const mes = mesDe();
  const filas = await sumarMes(mes);
  const i = filas.findIndex(f => f.id === user.id);
  const yo = i >= 0 ? filas[i] : { puntos: 0, visita: 0, registro: 0, compra: 0 };
  const sig = [...NIVELES].reverse().find(nv => nv.desde > yo.puntos) || null;
  res.status(200).json({
    mes, codigo: codigoDe(user.customer_number), puntos: yo.puntos, posicion: i >= 0 ? i + 1 : null, total: filas.length,
    desglose: { visitas: yo.visita || 0, registros: yo.registro || 0, compras: yo.compra || 0 },
    nivel: nivelDe(yo.puntos), siguiente: sig ? { nombre: sig.nombre, faltan: sig.desde - yo.puntos } : null,
    reglas: { puntos: PUNTOS, tope_visitas_dia: TOPE_VISITAS_DIA, minimo: MINIMO_PARA_GANAR },
  });
}

async function admin(req, res, body) {
  await requireAdmin(req);
  const mes = MES_RE.test(String(body.mes || "")) ? body.mes : mesDe();
  const filas = await sumarMes(mes);
  const n = await nombres(filas.map(f => f.id));
  // Para revisar antes de premiar: cuántas visitas vienen de cuántas personas distintas.
  const vis = await sbAll(`ranking_eventos?mes=eq.${mes}&tipo=eq.visita&anulado=eq.false&select=ref_user_id,visitante&limit=100000`);
  const distintos = new Map();
  for (const v of vis) { if (!distintos.has(v.ref_user_id)) distintos.set(v.ref_user_id, new Set()); distintos.get(v.ref_user_id).add(v.visitante); }
  res.status(200).json({
    mes, minimo: MINIMO_PARA_GANAR, premios: PREMIOS,
    filas: filas.map((f, i) => ({
      posicion: i + 1, ref_user_id: f.id, nombre: n.get(f.id)?.full_name || "", email: n.get(f.id)?.email || "",
      codigo: codigoDe(n.get(f.id)?.customer_number), puntos: f.puntos, nivel: nivelDe(f.puntos),
      visitas: f.visita || 0, visitantes_distintos: distintos.get(f.id)?.size || 0, registros: f.registro || 0, compras: f.compra || 0,
    })),
  });
}

async function anular(req, res, body) {
  await requireAdmin(req);
  const id = String(body.ref_user_id || "");
  const mes = String(body.mes || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !MES_RE.test(mes)) return res.status(400).json({ error: "Datos inválidos" });
  const tipo = ["visita", "registro", "compra"].includes(body.tipo) ? `&tipo=eq.${body.tipo}` : "";
  await sb(`ranking_eventos?ref_user_id=eq.${id}&mes=eq.${mes}${tipo}`, { method: "PATCH", body: JSON.stringify({ anulado: true }) });
  cacheTabla = { t: 0, mes: "", data: null };
  res.status(200).json({ ok: true });
}
