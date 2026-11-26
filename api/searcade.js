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
//   { action: "editar", id, nombre?, categoria?, precio?, semitono?, coleccion?, lema?, descripcion?, sub?, oscuras? }
//   (sub = subcategoría dentro de la categoría, p. ej. "Attack on Titan";
//    oscuras = el arte solo se ofrece en camisetas oscuras: es de recorte y en
//    las claras pierde las sombras)
//   { action: "borrar", id }
//   { action: "original", id, imagen }   el ORIGINAL va a una carpeta privada
//   { action: "descargar", id }          → { nombre, imagen } (solo con sesión)
//   { action: "proteger", id, imagen }   artes viejos: original a privado + vista previa
//   { action: "miniatura", id, imagen }  miniatura liviana (WebP ≤ 150 KB) para el perchero
//   { action: "subir-foto", titulo, arte?, imagen }  /  { action: "borrar-foto", id }   (lookbook)
//   { action: "editar-foto", id, titulo?, arte? }   arte = id del diseño que sale en la foto ("" = ninguno)
//
// Protección: la tienda solo publica una VISTA PREVIA (chica y con marca de
// agua, la arma el panel). El archivo original para imprimir queda en
// ~/searcade-privado/artes (fuera de la web) y solo se baja con sesión.
//
// Acceso del asistente (Claude): el mismo token de Admin → 🤖 Asistente de Rey
// Midas, en "Authorization: Bearer". Solo sirve para listar, subir, editar y
// guardar original/miniatura (ACCIONES_ASISTENTE): no borra ni descarga
// originales. Revocarlo en Rey Midas lo corta también aquí.
//
// Variables opcionales: SEARCADE_DIR (carpeta del subdominio; por defecto
// ~/searcade.reymidascr.com) y SEARCADE_PRIVADO (por defecto ~/searcade-privado).

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { handleError, readJson, signPayload, verifyToken, verifyPassword, requireAssistant } from "./_lib.js";

const ORIGINS = new Set(["https://searcade.reymidascr.com"]);
// El cuerpo de una consulta tiene tope de 1 MB (server/app.mjs) y el base64
// agranda un tercio: la imagen ya comprimida no puede pasar de ~720 KB.
export const MAX_IMG = 720 * 1024;
const MAX_ARTES = 500;

export function artesDir() {
  const base = process.env.SEARCADE_DIR || path.join(os.homedir(), "searcade.reymidascr.com");
  return path.join(base, "artes");
}
export function privadoDir() {
  return path.join(process.env.SEARCADE_PRIVADO || path.join(os.homedir(), "searcade-privado"), "artes");
}
const NOMBRE_ARTE = /^a-[a-z0-9]+-[0-9a-f]{6}(-v|-m)?\.(webp|png)$/;
export const MAX_MINI = 150 * 1024;
const indexPath = () => path.join(artesDir(), "artes.json");

// El índice guarda los artes y las fotos del lookbook (banners de la tienda).
function leerIndice() {
  try {
    const d = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
    return { artes: Array.isArray(d.artes) ? d.artes : [], lookbook: Array.isArray(d.lookbook) ? d.lookbook : [] };
  } catch {
    return { artes: [], lookbook: [] };
  }
}
export const leerArtes = () => leerIndice().artes;
export const leerLookbook = () => leerIndice().lookbook;

function escribirIndice(cambios) {
  const d = { ...leerIndice(), ...cambios };
  fs.mkdirSync(artesDir(), { recursive: true });
  const tmp = `${indexPath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ actualizado: new Date().toISOString(), artes: d.artes, lookbook: d.lookbook }, null, 1));
  fs.renameSync(tmp, indexPath());
}
const escribirArtes = (artes) => escribirIndice({ artes });

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
// Textos opcionales de cada arte (colección, lema, descripción)
const TEXTOS = { coleccion: 30, lema: 60, descripcion: 180, sub: 30 };
function limpiarTexto(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function textosDe(body) {
  const t = {};
  for (const [k, max] of Object.entries(TEXTOS)) if (k in body) t[k] = limpiarTexto(body[k], max);
  return t;
}

function limpiarPrecio(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 500 || n > 500000) throw bad("Precio inválido");
  return n;
}

export function decodificarImagen(dataUrl, { jpeg = false } = {}) {
  const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m || (m[1] === "jpeg" && !jpeg)) throw bad(jpeg ? "La imagen debe ser JPG, PNG o WebP" : "La imagen debe ser PNG o WebP");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_IMG) throw bad(`La imagen pesa ${Math.round(buf.length / 1024)} KB; el máximo es ${Math.round(MAX_IMG / 1024)} KB`);
  const esPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const esWebp = buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  const esJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const ok = m[1] === "png" ? esPng : m[1] === "webp" ? esWebp : esJpg;
  if (!ok) throw bad("El archivo no es una imagen válida");
  return { buf, ext: m[1] === "jpeg" ? "jpg" : m[1] };
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
    const arte = { id, nombre, categoria, precio, semitono: body.semitono === true, ...(body.oscuras === true ? { oscuras: true } : {}), ...textosDe(body), archivo: `artes/${archivo}`, creado: new Date().toISOString() };
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
    if ("oscuras" in body) { if (body.oscuras === true) a.oscuras = true; else delete a.oscuras; }
    Object.assign(a, textosDe(body));
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
    if (NOMBRE_ARTE.test(nombreArchivo)) {
      try { fs.unlinkSync(path.join(artesDir(), nombreArchivo)); } catch {}
    }
    const mini = path.basename(String(a.mini || "").split("?")[0]);
    if (mini && NOMBRE_ARTE.test(mini)) {
      try { fs.unlinkSync(path.join(artesDir(), mini)); } catch {}
    }
    if (a.original && NOMBRE_ARTE.test(a.original)) {
      try { fs.unlinkSync(path.join(privadoDir(), a.original)); } catch {}
    }
    const lookbook = leerLookbook();
    for (const f of lookbook) if (f.arte === a.id) delete f.arte;
    escribirIndice({ artes, lookbook });
    return { ok: true, artes };
  });
}

// ===== Original privado (para imprimir) =====
function buscar(artes, id) {
  const a = artes.find((x) => x.id === id);
  if (!a) throw Object.assign(new Error("Ese arte ya no existe"), { status: 404 });
  return a;
}
export async function guardarOriginal(body) {
  const { buf, ext } = decodificarImagen(body.imagen);
  return enCola(() => {
    const artes = leerArtes();
    const a = buscar(artes, body.id);
    fs.mkdirSync(privadoDir(), { recursive: true });
    const nombre = `${a.id}.${ext}`;
    fs.writeFileSync(path.join(privadoDir(), nombre), buf);
    a.original = nombre;
    a.protegido = true;
    escribirArtes(artes);
    return { ok: true, artes };
  });
}
export function descargarOriginal(body) {
  const a = buscar(leerArtes(), body.id);
  // Artes viejos sin proteger: el archivo sigue en la carpeta pública
  const ruta = a.original ? path.join(privadoDir(), a.original) : path.join(artesDir(), path.basename(String(a.archivo || "")));
  if (!fs.existsSync(ruta)) throw Object.assign(new Error("No se encontró el archivo original"), { status: 404 });
  const ext = path.extname(ruta).slice(1);
  return { ok: true, nombre: `${a.nombre}.${ext}`, imagen: `data:image/${ext};base64,${fs.readFileSync(ruta).toString("base64")}` };
}
// Arte subido antes de la protección: el archivo público pasa a privado y en su
// lugar queda la vista previa que manda el panel.
export async function protegerArte(body) {
  const { buf } = decodificarImagen(body.imagen);
  return enCola(() => {
    const artes = leerArtes();
    const a = buscar(artes, body.id);
    const publico = path.basename(String(a.archivo || ""));
    fs.mkdirSync(privadoDir(), { recursive: true });
    if (!a.original && NOMBRE_ARTE.test(publico) && fs.existsSync(path.join(artesDir(), publico))) {
      fs.copyFileSync(path.join(artesDir(), publico), path.join(privadoDir(), publico));
      fs.unlinkSync(path.join(artesDir(), publico));
      a.original = publico;
    }
    const vista = `${a.id}-v.webp`;
    fs.writeFileSync(path.join(artesDir(), vista), buf);
    // La miniatura vieja salió del archivo sin marca de agua: el panel arma otra
    const mini = path.basename(String(a.mini || "").split("?")[0]);
    if (mini && NOMBRE_ARTE.test(mini)) { try { fs.unlinkSync(path.join(artesDir(), mini)); } catch {} }
    delete a.mini;
    a.archivo = `artes/${vista}`;
    a.protegido = true;
    escribirArtes(artes);
    return { ok: true, artes };
  });
}

// Miniatura liviana para el perchero y las fichas (el panel la genera). Lleva
// ?v= para que una miniatura nueva no quede tapada por la caché de 7 días.
export async function guardarMiniatura(body) {
  const { buf, ext } = decodificarImagen(body.imagen);
  if (ext !== "webp") throw bad("La miniatura debe ser WebP");
  if (buf.length > MAX_MINI) throw bad(`La miniatura pesa ${Math.round(buf.length / 1024)} KB; el máximo es ${MAX_MINI / 1024} KB`);
  return enCola(() => {
    const artes = leerArtes();
    const a = buscar(artes, body.id);
    const nombre = `${a.id}-m.webp`;
    fs.mkdirSync(artesDir(), { recursive: true });
    fs.writeFileSync(path.join(artesDir(), nombre), buf);
    a.mini = `artes/${nombre}?v=${Date.now().toString(36)}`;
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

// ===== Lookbook: fotos y banners que el dueño sube para la tienda =====
const MAX_FOTOS = 40;
const limpiarTitulo = (v) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
// Diseño ligado a una foto del lookbook: tiene que existir (o vacío = ninguno).
function arteDeFoto(v, artes) {
  const id = String(v ?? "").trim();
  if (!id) return "";
  if (!artes.some((a) => a.id === id)) throw bad("Ese diseño ya no existe");
  return id;
}
export async function editarFoto(body) {
  return enCola(() => {
    const { artes, lookbook } = leerIndice();
    const f = lookbook.find((x) => x.id === body.id);
    if (!f) throw Object.assign(new Error("Esa foto ya no existe"), { status: 404 });
    if ("titulo" in body) f.titulo = limpiarTitulo(body.titulo);
    if ("arte" in body) { const a = arteDeFoto(body.arte, artes); if (a) f.arte = a; else delete f.arte; }
    escribirIndice({ lookbook });
    return { ok: true, lookbook };
  });
}
export async function subirFoto(body) {
  const titulo = limpiarTitulo(body.titulo);
  const { buf, ext } = decodificarImagen(body.imagen, { jpeg: true });
  return enCola(() => {
    const lookbook = leerLookbook();
    if (lookbook.length >= MAX_FOTOS) throw bad(`Ya hay ${MAX_FOTOS} fotos; borra alguna antes de subir más`);
    const arte = arteDeFoto(body.arte, leerArtes());
    const id = `f-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    fs.mkdirSync(artesDir(), { recursive: true });
    fs.writeFileSync(path.join(artesDir(), `${id}.${ext}`), buf);
    const foto = { id, titulo, ...(arte ? { arte } : {}), archivo: `artes/${id}.${ext}`, creado: new Date().toISOString() };
    lookbook.unshift(foto);
    escribirIndice({ lookbook });
    return { ok: true, foto, lookbook };
  });
}
export async function borrarFoto(body) {
  return enCola(() => {
    const lookbook = leerLookbook();
    const i = lookbook.findIndex((x) => x.id === body.id);
    if (i < 0) throw Object.assign(new Error("Esa foto ya no existe"), { status: 404 });
    const [f] = lookbook.splice(i, 1);
    const nombre = path.basename(String(f.archivo || ""));
    if (/^f-[a-z0-9]+-[0-9a-f]{6}\.(webp|png|jpg)$/.test(nombre)) { try { fs.unlinkSync(path.join(artesDir(), nombre)); } catch {} }
    escribirIndice({ lookbook });
    return { ok: true, lookbook };
  });
}

const ACCIONES_ASISTENTE = new Set(["yo", "listar", "subir", "editar", "original", "miniatura"]);

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
    let user;
    if (!body.token && /^Bearer\s+\S/i.test(String(req.headers.authorization || ""))) {
      await requireAssistant(req);
      if (!ACCIONES_ASISTENTE.has(body.action)) return res.status(403).json({ error: "El acceso del asistente no permite esta acción" });
      user = { nombre: "asistente" };
    } else user = requirePanel(body);
    switch (body.action) {
      case "yo": return res.status(200).json({ ok: true, nombre: user.nombre });
      case "listar": return res.status(200).json(leerIndice());
      case "subir-foto": return res.status(200).json(await subirFoto(body));
      case "borrar-foto": return res.status(200).json(await borrarFoto(body));
      case "editar-foto": return res.status(200).json(await editarFoto(body));
      case "subir": return res.status(200).json(await subirArte(body));
      case "editar": return res.status(200).json(await editarArte(body));
      case "borrar": return res.status(200).json(await borrarArte(body));
      case "original": return res.status(200).json(await guardarOriginal(body));
      case "descargar": return res.status(200).json(descargarOriginal(body));
      case "proteger": return res.status(200).json(await protegerArte(body));
      case "miniatura": return res.status(200).json(await guardarMiniatura(body));
      default: return res.status(400).json({ error: "Acción desconocida" });
    }
  } catch (err) {
    handleError(res, err);
  }
}
