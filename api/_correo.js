// Correos @reymidascr.com en Banahosting (cPanel), desde la API de la tienda.
//
// - Crear un buzón: la app Node.js corre dentro de la misma cuenta de cPanel,
//   así que usa la herramienta oficial `uapi` (Email::add_pop) sin pedir
//   ninguna clave extra. Una llamada a la vez y cortada a los 12 s: la cuenta
//   tiene tope de procesos (ver CLAUDE.md, caída del 14/11/2026).
// - Leer el correo de Sony: cPanel guarda cada buzón en formato Maildir en
//   ~/mail/<dominio>/<usuario>/{new,cur}. Se leen solo los archivos más
//   recientes, sin IMAP ni dependencias, y solo los mensajes de PlayStation.

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

export const MAIL_DOMAIN = "reymidascr.com";
const UAPI_BIN = process.env.UAPI_BIN || "uapi";
const HOME = process.env.MAIL_HOME || os.homedir() || path.join(process.cwd(), "..");

// Usuario del correo (lo que va antes de @): minúsculas, números, punto, guion.
export function cleanLocal(v) {
  const local = String(v || "").trim().toLowerCase().replace(new RegExp(`@${MAIL_DOMAIN.replace(".", "\\.")}$`), "");
  return /^[a-z0-9][a-z0-9._-]{2,40}$/.test(local) && !/\.\.|[._-]$/.test(local) ? local : "";
}

// Contraseña fuerte que acepten cPanel y PlayStation: 14 caracteres con
// mayúscula, minúscula, número y un símbolo simple.
export function makePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "#$%*+"];
  const all = sets.slice(0, 3).join("");
  const pick = s => s[crypto.randomInt(s.length)];
  const chars = sets.map(pick);
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

let busy = false;
function uapi(args) {
  if (busy) return Promise.reject(Object.assign(new Error("Hay otro correo creándose: probá de nuevo en unos segundos."), { status: 429 }));
  busy = true;
  return new Promise((resolve, reject) => {
    execFile(UAPI_BIN, ["--output=json", ...args], { timeout: 12000, maxBuffer: 1 << 20, killSignal: "SIGKILL" }, (err, stdout) => {
      busy = false;
      if (err && !stdout) {
        const e = new Error(err.code === "ENOENT"
          ? "Este servidor no tiene la herramienta de cPanel (uapi): el correo hay que crearlo a mano."
          : err.killed ? "cPanel no respondió a tiempo. Probá de nuevo." : "No se pudo hablar con cPanel.");
        e.status = 502;
        return reject(e);
      }
      try { resolve(JSON.parse(stdout).result || {}); }
      catch { reject(Object.assign(new Error("cPanel respondió algo inesperado."), { status: 502 })); }
    });
  });
}

function cpanelError(result, fallback) {
  const msg = (result.errors || []).join(" ").trim();
  if (/exist/i.test(msg)) return Object.assign(new Error("Ese correo ya existe en el hosting."), { status: 409 });
  return Object.assign(new Error(msg ? `cPanel: ${msg}` : fallback), { status: 502 });
}

// ¿Existe ya el buzón? (lee el disco: no gasta un proceso)
export function mailboxExists(local) {
  return fs.existsSync(path.join(HOME, "mail", MAIL_DOMAIN, local));
}

export async function createMailbox(local, password) {
  const r = await uapi(["Email", "add_pop", `email=${local}`, `password=${password}`, `domain=${MAIL_DOMAIN}`, "quota=1024"]);
  if (r.status !== 1) throw cpanelError(r, "cPanel no pudo crear el correo.");
  return `${local}@${MAIL_DOMAIN}`;
}

// Diagnóstico sin cambiar nada: ¿funciona uapi y dónde están los buzones?
export async function mailStatus() {
  let uapiOk = false, cuentas = null, error = "";
  try {
    const r = await uapi(["Email", "count_pops"]);
    uapiOk = r.status === 1;
    cuentas = typeof r.data === "number" ? r.data : (r.data?.count ?? null);
    if (!uapiOk) error = (r.errors || []).join(" ");
  } catch (e) { error = e.message; }
  return { uapi: uapiOk, buzones: cuentas, maildir: fs.existsSync(path.join(HOME, "mail", MAIL_DOMAIN)), error };
}

// ---------- Leer los últimos correos de PlayStation de un buzón ----------
function decodeQP(s) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeWords(s) {
  return String(s || "").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, enc, txt) => {
    try {
      const buf = enc.toLowerCase() === "b" ? Buffer.from(txt, "base64") : Buffer.from(decodeQP(txt.replace(/_/g, " ")), "latin1");
      return buf.toString(/utf-?8/i.test(cs) ? "utf8" : "latin1");
    } catch { return txt; }
  });
}
// Texto legible de un mensaje MIME (todas sus partes text/*).
function messageText(raw) {
  const out = [];
  const walk = (part) => {
    const sep = part.search(/\r?\n\r?\n/);
    const head = sep >= 0 ? part.slice(0, sep) : part;
    let body = sep >= 0 ? part.slice(sep).replace(/^\r?\n\r?\n/, "") : "";
    const ctype = (head.match(/^content-type:\s*([^;\r\n]+)/im) || [])[1] || "text/plain";
    const boundary = (head.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
    if (/^multipart\//i.test(ctype) && boundary) {
      for (const p of body.split("--" + boundary).slice(1)) if (!p.startsWith("--")) walk(p);
      return;
    }
    if (!/^text\//i.test(ctype)) return;
    const enc = ((head.match(/^content-transfer-encoding:\s*(\S+)/im) || [])[1] || "").toLowerCase();
    if (enc === "base64") body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    else if (enc === "quoted-printable") body = Buffer.from(decodeQP(body), "latin1").toString("utf8");
    if (/html/i.test(ctype)) {
      body = body.replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, " $1 ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    }
    out.push(body);
  };
  walk(raw);
  return out.join("\n").replace(/[ \t]+/g, " ");
}

const SONY_FROM = /playstation|sony|sonyentertainmentnetwork|scea|sie\.com/i;
const SONY_LINK = /^https?:\/\/[^\s"'<>]*(playstation\.(com|net)|sonyentertainmentnetwork\.com|sony\.com)[^\s"'<>]*/i;

export function readSonyMail(local, { days = 7, max = 5 } = {}) {
  const base = path.join(HOME, "mail", MAIL_DOMAIN, local);
  if (!fs.existsSync(base)) return { exists: false, messages: [] };
  const since = Date.now() - days * 24 * 3600 * 1000;
  const files = [];
  for (const sub of ["new", "cur"]) {
    const dir = path.join(base, sub);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      try { const st = fs.statSync(path.join(dir, n)); if (st.isFile() && st.mtimeMs >= since) files.push({ f: path.join(dir, n), t: st.mtimeMs, size: st.size }); } catch {}
    }
  }
  files.sort((a, b) => b.t - a.t);
  const messages = [];
  for (const { f, t, size } of files.slice(0, 30)) {
    if (messages.length >= max) break;
    let raw;
    try {
      const fd = fs.openSync(f, "r"); const buf = Buffer.alloc(Math.min(size, 400 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); raw = buf.toString("latin1");
    } catch { continue; }
    const headEnd = raw.search(/\r?\n\r?\n/);
    const head = (headEnd >= 0 ? raw.slice(0, headEnd) : raw).replace(/\r?\n[ \t]+/g, " ");
    const from = decodeWords((head.match(/^from:\s*(.+)$/im) || [])[1] || "");
    if (!SONY_FROM.test(from)) continue;
    const subject = decodeWords((head.match(/^subject:\s*(.+)$/im) || [])[1] || "");
    const text = messageText(raw);
    // El mismo enlace suele venir en la parte de texto y en la HTML (con otros
    // parámetros): se deja uno por destino (ruta + primer parámetro).
    const seen = new Set();
    const links = (text.match(/https?:\/\/[^\s"'<>]+/g) || []).map(u => u.replace(/[).,;]+$/, ""))
      .filter(u => SONY_LINK.test(u) && /verif|confirm|activ|validate|email|token|code/i.test(u))
      .filter(u => { const k = u.split("&")[0]; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 3);
    const codes = [...new Set((`${subject}\n${text}`.match(/(?<![\d#])\d{6}(?!\d)/g) || []))].slice(0, 3);
    messages.push({ fecha: new Date(t).toISOString(), de: from.slice(0, 120), asunto: subject.slice(0, 160), codigos: codes, enlaces: links });
  }
  return { exists: true, messages };
}
