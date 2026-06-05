// Endpoint de autenticación. Maneja login, info de sesión,
// cambio de contraseña y bootstrap del primer admin.
//
// POST /api/auth con { action: "login" | "me" | "change-password" | "bootstrap" | "logout", ... }

import {
  sb, hashPassword, verifyPassword, makeSessionToken,
  requireAuth, handleError, readJson, checkConfig,
  setSessionCookie, clearSessionCookie, checkRateLimit,
  invalidateSessions,
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
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

async function login(req, res, body) {
  // 10 intentos por IP cada 15 minutos
  checkRateLimit(req, { prefix: "login", max: 10, windowMs: 15 * 60 * 1000 });
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son requeridos" });
  }
  const users = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=*`);
  const user = users[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Email o contraseña incorrectos" });
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

async function logout(req, res) {
  try {
    const user = await requireAuth(req);
    await invalidateSessions(user.id);
  } catch { /* sesión ya inválida — igual limpiamos la cookie */ }
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}

async function changePassword(req, res, body) {
  const user = await requireAuth(req);
  const currentPassword = String(body.current_password || "");
  const newPassword = String(body.password || "");
  if (!currentPassword) {
    return res.status(400).json({ error: "La contraseña actual es requerida" });
  }
  const [fullUser] = await sb(`app_users?id=eq.${user.id}&select=password_hash`);
  if (!verifyPassword(currentPassword, fullUser.password_hash)) {
    return res.status(401).json({ error: "Contraseña actual incorrecta" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }
  const validFrom = Math.floor(Date.now() / 1000);
  await sb(`app_users?id=eq.${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ password_hash: hashPassword(newPassword), sessions_valid_from: validFrom }),
  });
  // Emitir un token nuevo para que la sesión actual siga activa
  // (iat del nuevo token es >= validFrom, así que pasa la validación).
  const newToken = makeSessionToken(user.id);
  setSessionCookie(res, newToken);
  res.status(200).json({ ok: true });
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
