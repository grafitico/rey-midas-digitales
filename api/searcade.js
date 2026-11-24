// SEARCADE (searcade.reymidascr.com): artes que el dueño sube desde
// searcade.reymidascr.com/admin.html y que la tienda estampa sobre las camisetas.
//
// Los archivos quedan en ~/searcade.reymidascr.com/artes/ (misma cuenta de
// cPanel que esta app) junto con el índice artes.json, que la tienda lee
// directo como archivo estático: mirar la tienda no pasa por esta API. El
// deploy por FTP no los toca porque no están en el repo.
//
// POST /api/searcade (solo administradores; la sesión es la cookie de
// reymidascr.com, que el navegador manda porque searcade.* es el mismo sitio):
//   { action: "yo" }                                   → { ok, nombre }
//   { action: "listar" }                               → { artes }
//   { action: "subir", nombre, categoria, precio, imagen: "data:image/webp;base64,..." }
//   { action: "editar", id, nombre?, categoria?, precio? }
//   { action: "borrar", id }
//
// Variable opcional: SEARCADE_DIR (carpeta del subdominio; por defecto
// ~/searcade.reymidascr.com).

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { requireAdmin, handleError, readJson } from "./_lib.js";

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
    const arte = { id, nombre, categoria, precio, archivo: `artes/${archivo}`, creado: new Date().toISOString() };
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
    const body = await readJson(req);
    const user = await requireAdmin(req);
    switch (body.action) {
      case "yo": return res.status(200).json({ ok: true, nombre: user.full_name || user.email });
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
