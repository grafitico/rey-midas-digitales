// Correos @reymidascr.com en Banahosting (cPanel), desde la API de la tienda.
//
// - Crear un buzón: por la API web de cPanel (UAPI por HTTPS, puerto 2083)
//   con un token de API de cPanel guardado en las variables de entorno de la
//   app (CPANEL_USER, CPANEL_TOKEN; CPANEL_HOST opcional, por defecto
//   127.0.0.1). NO se lanza `uapi` como proceso hijo: el 21/11/2026 crear un
//   buzón así hizo que Banahosting cortara la app por el tope de recursos de
//   la cuenta (mismo límite de la caída del 14/11, ver CLAUDE.md). Sin token,
//   crear correos queda desactivado y el resto sigue funcionando.
// - Leer el correo de Sony: cPanel guarda cada buzón en formato Maildir en
//   ~/mail/<dominio>/<usuario>/{new,cur}. Se leen solo los archivos más
//   recientes, sin IMAP ni dependencias, y solo los mensajes de PlayStation.

import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import crypto from "crypto";

export const MAIL_DOMAIN = "reymidascr.com";
const HOME = process.env.MAIL_HOME || os.homedir() || path.join(process.cwd(), "..");
const CPANEL_HOST = process.env.CPANEL_HOST || "127.0.0.1";
const CPANEL_PORT = Number(process.env.CPANEL_PORT || 2083);

export function canCreateMail() {
  return !!(process.env.CPANEL_USER && process.env.CPANEL_TOKEN);
}

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

// Una llamada a cPanel a la vez, cortada a los 12 s (regla de CLAUDE.md).
let busy = false;
function cpanelApi(module, fn, params) {
  if (!canCreateMail()) {
    return Promise.reject(Object.assign(new Error("Crear correos automáticamente no está activado (falta el token de cPanel). Crealo a mano en cPanel → Cuentas de correo y registrá la cuenta sin marcar \"Crear el correo\"."), { status: 503 }));
  }
  if (busy) return Promise.reject(Object.assign(new Error("Hay otro correo creándose: probá de nuevo en unos segundos."), { status: 429 }));
  busy = true;
  const qs = new URLSearchParams(params).toString();
  const local = /^(127\.0\.0\.1|localhost)$/.test(CPANEL_HOST);
  return new Promise((resolve, reject) => {
    const done = (fn2) => (x) => { busy = false; fn2(x); };
    const req = https.request({
      host: CPANEL_HOST, port: CPANEL_PORT, method: "GET", path: `/execute/${module}/${fn}?${qs}`,
      headers: { Authorization: `cpanel ${process.env.CPANEL_USER}:${process.env.CPANEL_TOKEN}` },
      // En 127.0.0.1 el certificado es del nombre del servidor, no de la IP:
      // la conexión no sale de la máquina, así que no se valida el nombre.
      rejectUnauthorized: !local,
      timeout: 12000,
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { if (body.length < 1 << 20) body += c; });
      res.on("end", done(() => {
        if (res.statusCode === 401 || res.statusCode === 403) return reject(Object.assign(new Error("cPanel rechazó el token: revisá CPANEL_USER y CPANEL_TOKEN en la app Node.js."), { status: 502 }));
        try { const j = JSON.parse(body); resolve({ status: j.status, errors: j.errors, data: j.data }); }
        catch { reject(Object.assign(new Error("cPanel respondió algo inesperado."), { status: 502 })); }
      }));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("cPanel no respondió a tiempo. Probá de nuevo."), { status: 504 })));
    req.on("error", done(err => reject(err.status ? err : Object.assign(new Error("No se pudo conectar con cPanel."), { status: 502 }))));
    req.end();
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
  const r = await cpanelApi("Email", "add_pop", { email: local, password, domain: MAIL_DOMAIN, quota: "1024" });
  if (r.status !== 1) throw cpanelError(r, "cPanel no pudo crear el correo.");
  return `${local}@${MAIL_DOMAIN}`;
}

// Diagnóstico sin cambiar nada y sin llamar a cPanel: ¿está activado crear
// correos y se ven los buzones en el disco?
export function mailStatus() {
  const dir = path.join(HOME, "mail", MAIL_DOMAIN);
  let buzones = null;
  try { buzones = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).length; } catch {}
  return { crear_correos: canCreateMail(), buzones, maildir: fs.existsSync(dir) };
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
