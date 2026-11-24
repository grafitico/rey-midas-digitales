// SEARCADE (searcade.reymidascr.com): artes que el dueño sube desde
// searcade.reymidascr.com/admin.html y que la tienda estampa sobre las camisetas.
//
// Los archivos quedan en ~/searcade.reymidascr.com/artes/ (misma cuenta de
// cPanel que esta app) junto con el índice artes.json, que la tienda lee
// directo como archivo estático: mirar la tienda no pasa por esta API. El
// deploy por FTP no los toca porque no están en el repo.
//
// POST /api/searcade. El panel tiene su PROPIO acceso (no usa el de Rey
// Midas): usuario y contraseña en las variables de entorno de la app Node.js
// de cPanel, SEARCADE_USUARIO y SEARCADE_CLAVE (texto o hash "scrypt$..." de
// scripts/hash-password.mjs). Al entrar se recibe un token de 30 días que el
// panel manda en cada consulta (campo "token"); solo sirve para esta API.
//   { action: "entrar", usuario, clave }               → { ok, token, nombre }
//   { action: "yo", token }                            → { ok, nombre }
//   { action: "listar" }                               → { artes }
//   { action: "subir", nombre, categoria, precio, semitono, imagen: "data:image/webp;base64,..." }
//   { action: "editar", id, nombre?, categoria?, precio?, semitono? }
//   { action: "borrar", id }
//
// Variable opcional: SEARCADE_DIR (carpeta del subdominio; por defecto
// ~/searcade.reymidascr.com).

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { handleError, readJson, signPayload, verifyToken, verifyPassword } from "./_lib.js";

const ORIGINS = new Set(["https://searcade.reymidascr.com"]);
// El cuerpo de una consulta tiene tope de 1 MB (server/app.mjs) y el base64
// agranda un tercio: la imagen ya comprimida no puede pasar de ~720 KB.
export const MAX_IMG = 720 * 1024;
const MAX_ARTES = 500;

export function artesDir() {
  const base = process.env.SEARCADE_DIR || path.join(os.homedir(), "searcade.reymidascr.com");
  return path.join(base, "artes");
}
const indexPath = () => path.join(artesDir(), "artes.json");

export function leerArtes() {
  try {
    const d = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
    return Array.isArray(d.artes) ? d.artes : [];
  } catch {
    return [];
  }
}

function escribirArtes(artes) {
  fs.mkdirSync(artesDir(), { recursive: true });
  const tmp = `${indexPath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ actualizado: new Date().toISOString(), artes }, null, 1));
  fs.renameSync(tmp, indexPath());
}

// Un cambio a la vez, para que dos subidas seguidas no se pisen el índice.
let cola = Promise.resolve();
const enCola = (fn) => (cola = cola.then(fn, fn));

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function limpiarNombre(v) {
  const s = String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
  if (!s) throw bad("Falta el nombre del arte");
  return s;
}
function limpiarCategoria(v) {
  const s = String(v ?? "").toLowerCase().trim();
  if (!/^[a-z0-9-]{1,20}$/.test(s)) throw bad("Categoría inválida");
  return s;
}
function limpiarPrecio(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 500 || n > 500000) throw bad("Precio inválido");
  return n;
}

export function decodificarImagen(dataUrl) {
  const m = /^data:image\/(webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw bad("La imagen debe ser PNG o WebP");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_IMG) throw bad(`La imagen pesa ${Math.round(buf.length / 1024)} KB; el máximo es ${Math.round(MAX_IMG / 1024)} KB`);
  const esPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const esWebp = buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  if (m[1] === "png" ? !esPng : !esWebp) throw bad("El archivo no es una imagen válida");
  return { buf, ext: m[1] };
}

export async function subirArte(body) {
  const nombre = limpiarNombre(body.nombre);
  const categoria = limpiarCategoria(body.categoria);
  const precio = limpiarPrecio(body.precio);
  const { buf, ext } = decodificarImagen(body.imagen);
  return enCola(() => {
    const artes = leerArtes();
    if (artes.length >= MAX_ARTES) throw bad(`Ya hay ${MAX_ARTES} artes; borra alguno antes de subir más`);
    const id = `a-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const archivo = `${id}.${ext}`;
    fs.mkdirSync(artesDir(), { recursive: true });
    fs.writeFileSync(path.join(artesDir(), archivo), buf);
    const arte = { id, nombre, categoria, precio, semitono: body.semitono === true, archivo: `artes/${archivo}`, creado: new Date().toISOString() };
    artes.unshift(arte);
    escribirArtes(artes);
    return { ok: true, arte, artes };
  });
}

export async function editarArte(body) {
  return enCola(() => {
    const artes = leerArtes();
    const a = artes.find((x) => x.id === body.id);
    if (!a) throw Object.assign(new Error("Ese arte ya no existe"), { status: 404 });
    if ("nombre" in body) a.nombre = limpiarNombre(body.nombre);
    if ("categoria" in body) a.categoria = limpiarCategoria(body.categoria);
    if ("precio" in body) a.precio = limpiarPrecio(body.precio);
    if ("semitono" in body) a.semitono = body.semitono === true;
    escribirArtes(artes);
    return { ok: true, artes };
  });
}

export async function borrarArte(body) {
  return enCola(() => {
    const artes = leerArtes();
    const i = artes.findIndex((x) => x.id === body.id);
    if (i < 0) throw Object.assign(new Error("Ese arte ya no existe"), { status: 404 });
    const [a] = artes.splice(i, 1);
    const nombreArchivo = path.basename(String(a.archivo || ""));
    if (/^a-[a-z0-9]+-[0-9a-f]{6}\.(webp|png)$/.test(nombreArchivo)) {
      try { fs.unlinkSync(path.join(artesDir(), nombreArchivo)); } catch {}
    }
    escribirArtes(artes);
    return { ok: true, artes };
  });
}

// ===== Acceso propio del panel =====
const SCOPE = "searcade";
const DIAS = 30;
const acceso = () => ({ usuario: String(process.env.SEARCADE_USUARIO || "").trim(), clave: String(process.env.SEARCADE_CLAVE || "") });
// Huella de las credenciales: si cambian, los tokens viejos dejan de servir.
const huella = ({ usuario, clave }) => crypto.createHash("sha256").update(`${usuario.toLowerCase()}\n${clave}`).digest("hex").slice(0, 16);
const iguales = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// Intentos fallidos por IP: 5 cada 15 minutos (en memoria, sin temporizadores).
const FALLOS = new Map();
const VENTANA = 15 * 60 * 1000, MAX_FALLOS = 5;
const ipDe = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
function bloqueado(ip) {
  const ahora = Date.now();
  for (const [k, v] of FALLOS) if (ahora - v.desde > VENTANA) FALLOS.delete(k);
  const f = FALLOS.get(ip);
  return f && f.n >= MAX_FALLOS ? Math.ceil((f.desde + VENTANA - ahora) / 60000) : 0;
}
function fallo(ip) {
  const f = FALLOS.get(ip);
  if (f) f.n++; else FALLOS.set(ip, { n: 1, desde: Date.now() });
}

export function entrar(body, ip = "?") {
  const cred = acceso();
  if (!cred.usuario || !cred.clave) throw Object.assign(new Error("El acceso del panel no está configurado (faltan SEARCADE_USUARIO y SEARCADE_CLAVE en cPanel)"), { status: 503 });
  const espera = bloqueado(ip);
  if (espera) throw Object.assign(new Error(`Demasiados intentos. Prueba de nuevo en ${espera} min.`), { status: 429 });
  const usuarioOk = iguales(String(body.usuario || "").trim().toLowerCase(), cred.usuario.toLowerCase());
  const clave = String(body.clave || "");
  const claveOk = cred.clave.startsWith("scrypt$") ? verifyPassword(clave, cred.clave) : iguales(clave, cred.clave);
  if (!usuarioOk || !claveOk) {
    fallo(ip);
    throw Object.assign(new Error("Usuario o contraseña incorrectos"), { status: 401 });
  }
  FALLOS.delete(ip);
  const ahora = Math.floor(Date.now() / 1000);
  const token = signPayload({ scope: SCOPE, sub: cred.usuario, h: huella(cred), iat: ahora, exp: ahora + DIAS * 24 * 3600 });
  return { ok: true, token, nombre: cred.usuario };
}

export function requirePanel(body) {
  const p = verifyToken(String(body.token || ""));
  const cred = acceso();
  if (!p || p.scope !== SCOPE || !cred.usuario || p.h !== huella(cred)) {
    throw Object.assign(new Error("Sesión vencida: vuelve a entrar"), { status: 401 });
  }
  return { nombre: p.sub };
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  cors(req, res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    // El panel manda el JSON como text/plain: así es una consulta "simple"
    // sin preflight OPTIONS, que algunos navegadores (Brave) y filtros cortan.
    let body;
    if (typeof req.body === "string") {
      try { body = JSON.parse(req.body || "{}"); } catch { return res.status(400).json({ error: "Datos inválidos" }); }
    } else body = await readJson(req);
    if (body.action === "entrar") return res.status(200).json(entrar(body, ipDe(req)));
    const user = requirePanel(body);
    switch (body.action) {
      case "yo": return res.status(200).json({ ok: true, nombre: user.nombre });
      case "listar": return res.status(200).json({ artes: leerArtes() });
      case "subir": return res.status(200).json(await subirArte(body));
      case "editar": return res.status(200).json(await editarArte(body));
      case "borrar": return res.status(200).json(await borrarArte(body));
      default: return res.status(400).json({ error: "Acción desconocida" });
    }
  } catch (err) {
    handleError(res, err);
  }
}
