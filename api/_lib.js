// Helpers compartidos por los endpoints de auth y datos.
// Usa Supabase solo como base de datos vía REST API + service_role key.
// Nada de Supabase Auth, nada de magic links, nada de SMTP.

import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// AUTH_SECRET firma los tokens de sesión. Si no está seteado, lo derivamos
// determinísticamente del service_role key (que ya es secreto).
const AUTH_SECRET = process.env.AUTH_SECRET
  ? Buffer.from(process.env.AUTH_SECRET)
  : (SERVICE_KEY ? crypto.createHash("sha256").update(SERVICE_KEY).digest() : null);

export function checkConfig() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    const err = new Error("Servidor mal configurado: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel.");
    err.status = 500;
    throw err;
  }
}

export async function sb(path, options = {}) {
  checkConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Supabase error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ===== Password hashing (scrypt) =====
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltB64, hashB64] = stored.split("$");
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

// ===== Tokens HMAC =====
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function signPayload(payload) {
  if (!AUTH_SECRET) throw new Error("AUTH_SECRET no configurado");
  const head = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(head).digest());
  return `${head}.${sig}`;
}

export function makeSessionToken(userId) {
  return signPayload({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 días
    iat: Math.floor(Date.now() / 1000),
  });
}

export function verifyToken(token) {
  if (!token || !AUTH_SECRET) return null;
  const [head, sig] = token.split(".");
  if (!head || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(head).digest());
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(b64urlDecode(head).toString("utf8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ===== Sesión vía cookie httpOnly =====
// El token de sesión viaja en una cookie HttpOnly: el JavaScript del navegador
// NO puede leerla, así que un XSS no puede robar la sesión con localStorage.
// SameSite=Lax evita además que valga para CSRF desde otro sitio.
const SESSION_COOKIE = "rmd_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días (igual que la expiración del token)

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Lee el token de la cookie de sesión y, como respaldo, del header
// Authorization (compatibilidad con clientes que aún manden Bearer).
export function getSessionToken(req) {
  const fromCookie = parseCookies(req)[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization || "";
  return auth.replace(/^Bearer\s+/i, "");
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function requireAuth(req) {
  const token = getSessionToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    const err = new Error("Sesión inválida o expirada");
    err.status = 401;
    throw err;
  }
  const users = await sb(`app_users?id=eq.${payload.sub}&select=id,email,full_name,is_admin`);
  const user = users[0];
  if (!user) {
    const err = new Error("Usuario no encontrado");
    err.status = 401;
    throw err;
  }
  return user;
}

export async function requireAdmin(req) {
  const user = await requireAuth(req);
  if (!user.is_admin) {
    const err = new Error("Solo administradores pueden hacer esto");
    err.status = 403;
    throw err;
  }
  return user;
}

export function handleError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message });
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
