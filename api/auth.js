// Endpoint de autenticación. Maneja login, info de sesión,
// cambio de contraseña y bootstrap del primer admin.
//
// POST /api/auth con { action: "login" | "me" | "change-password" | "bootstrap" | "logout", ... }
//
// El login con Google (googleFlow, más abajo) vive en este mismo archivo —
// no en api/auth-google.js aparte — porque el plan Hobby de Vercel tope a
// 12 Serverless Functions por deploy y ya estábamos justo en el límite.
// vercel.json tiene un rewrite de /api/auth-google -> /api/auth para que la
// URL de redirect que se registra en Google Cloud Console no cambie.

import crypto from "crypto";
import {
  sb, hashPassword, verifyPassword, makeSessionToken,
  requireAuth, handleError, readJson, checkConfig,
  setSessionCookie, clearSessionCookie, signPayload, verifyToken,
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "GET") return await googleFlow(req, res);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    checkConfig();
    const body = await readJson(req);
    const action = body.action;
    if (action === "login") return await login(req, res, body);
    if (action === "register") return await register(req, res, body);
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
      customer_number: user.customer_number,
    },
  });
}

// Alta de cuenta de cliente por el propio usuario (sin admin de por medio).
// Mismo patrón tolerante que api/clients.js create(): phone/console solo
// viajan al insert si vienen con valor, para no romper si la migración
// add_client_fields.sql todavía no corrió. El número de cliente lo asigna
// solo la secuencia de la tabla (app_users_customer_number_seq).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function register(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = body.full_name ? String(body.full_name).trim() : null;
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Ingresá un email válido" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }
  const existing = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing.length) {
    return res.status(400).json({ error: "Ya existe una cuenta con ese email. Iniciá sesión." });
  }
  const insert = {
    email,
    password_hash: hashPassword(password),
    is_admin: false,
    full_name: fullName,
  };
  const phone = body.phone ? String(body.phone).trim() : null;
  const consoleVal = body.console ? String(body.console).trim() : null;
  if (phone) insert.phone = phone;
  if (consoleVal) insert.console = consoleVal;
  const inserted = await sb(`app_users`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(insert),
  });
  const user = inserted[0];
  const token = makeSessionToken(user.id);
  setSessionCookie(res, token); // sesión en cookie HttpOnly, no en localStorage
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      is_admin: false,
      customer_number: user.customer_number,
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

// ===== Login / registro con "Continuar con Google" =====
// OAuth2 directo (Authorization Code, todo por GET + redirects) — nada de
// Supabase Auth ni del SDK JS de Google. Así no hace falta tocar la CSP:
// es navegación normal del navegador, no fetch cross-origin desde el cliente.
// Requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel — setup en
// GOOGLE-LOGIN-SETUP.md.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = "https://reymidascr.com/api/auth-google";

function redirect(res, path) {
  res.writeHead(302, { Location: path });
  res.end();
}

async function googleFlow(req, res) {
  try {
    checkConfig();
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return redirect(res, "/login?google_error=" + encodeURIComponent("El login con Google todavía no está configurado."));
    }
    const { code, state, error } = req.query;
    if (error) {
      return redirect(res, "/login?google_error=" + encodeURIComponent("Cancelaste el acceso con Google."));
    }
    if (!code) return startGoogleFlow(res);
    return await finishGoogleFlow(res, String(code), state);
  } catch (err) {
    console.error("[auth-google]", err);
    return redirect(res, "/login?google_error=" + encodeURIComponent("No pudimos conectar con Google. Probá de nuevo."));
  }
}

function startGoogleFlow(res) {
  // State firmado y con expiración corta: no hace falta guardarlo en ningún
  // lado, con verificar la firma al volver alcanza para el anti-CSRF.
  const state = signPayload({ n: crypto.randomBytes(8).toString("hex"), exp: Math.floor(Date.now() / 1000) + 600 });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

async function finishGoogleFlow(res, code, state) {
  if (!verifyToken(state)) {
    return redirect(res, "/login?google_error=" + encodeURIComponent("El enlace de Google venció, probá de nuevo."));
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Google no devolvió un token válido");
  }

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok || !profile.email) {
    throw new Error("Google no devolvió el email de la cuenta");
  }
  if (profile.email_verified === false) {
    return redirect(res, "/login?google_error=" + encodeURIComponent("Esa cuenta de Google no tiene el email verificado."));
  }

  const email = String(profile.email).trim().toLowerCase();
  const existing = await sb(`app_users?email=eq.${encodeURIComponent(email)}&select=id,is_admin`);
  let user = existing[0];
  let isNew = false;
  if (!user) {
    isNew = true;
    const inserted = await sb(`app_users`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        email,
        // Contraseña al azar: esta cuenta solo entra por Google, nadie la usa.
        password_hash: hashPassword(crypto.randomBytes(32).toString("hex")),
        is_admin: false,
        full_name: profile.name || null,
      }),
    });
    user = inserted[0];
  }

  const token = makeSessionToken(user.id);
  setSessionCookie(res, token);
  const dest = user.is_admin ? "/admin" : "/mi-cuenta";
  redirect(res, `${dest}?google=${isNew ? "nuevo" : "ok"}`);
}
