// Endpoint de autenticación. Maneja login, info de sesión,
// cambio de contraseña y bootstrap del primer admin.
//
// POST /api/auth con { action: "login" | "me" | "change-password" | "bootstrap" | "logout", ... }

import {
  sb, hashPassword, verifyPassword, makeSessionToken,
  requireAuth, handleError, readJson, checkConfig,
  setSessionCookie, clearSessionCookie,
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    checkConfig();
    const body = await readJson(req);
    const action = body.action;
    if (action === "login") return await login(req, res, body);
    if (action === "me") return await me(req, res);
    if (action === "change-password") return await changePassword(req, res, body);
    if (action === "bootstrap") return await bootstrap(req, res, body);
    if (action === "logout") return logout(req, res);
    if (action === "has-users") return await hasUsers(req, res);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

// Bloqueo por fuerza bruta: tras MAX_ATTEMPTS fallos seguidos, la cuenta queda
// bloqueada LOCK_MINUTES. Requiere la migración add_login_rate_limit.sql
// (columnas failed_attempts/locked_until en app_users); si todavía no corrió,
// las columnas no existen y el login sigue funcionando SIN límite de intentos
// (mismo patrón tolerante que sbWithAmount/selectClients en el resto del API).
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// PATCH best-effort: si failed_attempts/locked_until todavía no existen en la
// tabla (migración sin correr), no rompe el login — solo no hay rate limit.
async function patchAttemptsBestEffort(userId, patch) {
  try {
    await sb(`app_users?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
  } catch (err) {
    if (!/failed_attempts|locked_until|does not exist/i.test(err.message || "")) throw err;
  }
}

async function login(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son requeridos" });
  }
  const users = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=*`);
  const user = users[0];

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(429).json({ error: "Demasiados intentos fallidos. Probá de nuevo en unos minutos." });
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    if (user) {
      const attempts = (user.failed_attempts || 0) + 1;
      const patch = { failed_attempts: attempts };
      if (attempts >= MAX_ATTEMPTS) {
        patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
      }
      await patchAttemptsBestEffort(user.id, patch);
    }
    return res.status(401).json({ error: "Email o contraseña incorrectos" });
  }

  if (user.failed_attempts || user.locked_until) {
    await patchAttemptsBestEffort(user.id, { failed_attempts: 0, locked_until: null });
  }

  const token = makeSessionToken(user.id);
  setSessionCookie(res, token); // sesión en cookie HttpOnly, no en localStorage
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      is_admin: user.is_admin,
    },
  });
}

async function me(req, res) {
  const user = await requireAuth(req);
  res.status(200).json({ user });
}

function logout(req, res) {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}

async function changePassword(req, res, body) {
  const user = await requireAuth(req);
  const password = String(body.password || "");
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }
  await sb(`app_users?id=eq.${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ password_hash: hashPassword(password) }),
  });
  res.status(200).json({ ok: true });
}

// Devuelve si ya existe algún usuario registrado (sin forzar un 403 en el cliente).
// Reemplaza el hack de "bootstrap dummy" que ensuciaba la consola del navegador.
async function hasUsers(req, res) {
  const existing = await sb(`app_users?select=id&limit=1`);
  return res.status(200).json({ usersExist: existing.length > 0 });
}

// Solo funciona si NO hay usuarios todavía. Sirve para crear el primer admin.
async function bootstrap(req, res, body) {
  const existing = await sb(`app_users?select=id&limit=1`);
  if (existing.length > 0) {
    return res.status(403).json({ error: "Ya hay usuarios. El bootstrap está deshabilitado." });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = body.full_name ? String(body.full_name).trim() : null;
  if (!email || password.length < 6) {
    return res.status(400).json({ error: "Email y contraseña (6+ caracteres) son requeridos" });
  }
  const inserted = await sb(`app_users`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      email,
      password_hash: hashPassword(password),
      is_admin: true,
      full_name: fullName,
    }),
  });
  const user = inserted[0];
  const token = makeSessionToken(user.id);
  setSessionCookie(res, token); // sesión en cookie HttpOnly, no en localStorage
  res.status(200).json({
    user: { id: user.id, email: user.email, full_name: user.full_name, is_admin: true },
  });
}
