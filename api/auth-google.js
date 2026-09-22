// Login / registro con "Continuar con Google". Es OAuth2 puro (Authorization
// Code, todo por GET + redirects) — nada de Supabase Auth, nada del SDK JS
// de Google. Así no hace falta tocar la CSP (no cargamos scripts de terceros,
// es navegación normal del navegador) y seguimos usando las mismas cookies
// de sesión propias de siempre (ver api/_lib.js).
//
// Requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel. Setup completo
// en GOOGLE-LOGIN-SETUP.md.
//
// GET /api/auth-google           -> arranca el flujo (redirige a Google)
// GET /api/auth-google?code=...  -> vuelta de Google: busca o crea el cliente
//                                    y redirige a /mi-cuenta (o /admin) ya logueado

import crypto from "crypto";
import { sb, hashPassword, makeSessionToken, setSessionCookie, signPayload, verifyToken, checkConfig } from "./_lib.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SITE_URL = "https://reymidascr.com";
const REDIRECT_URI = `${SITE_URL}/api/auth-google`;

function redirect(res, path) {
  res.writeHead(302, { Location: path });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  try {
    checkConfig();
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return redirect(res, "/login?google_error=" + encodeURIComponent("El login con Google todavía no está configurado."));
    }
    const { code, state, error } = req.query;
    if (error) {
      return redirect(res, "/login?google_error=" + encodeURIComponent("Cancelaste el acceso con Google."));
    }
    if (!code) return startFlow(res);
    return await finishFlow(res, String(code), state);
  } catch (err) {
    console.error("[auth-google]", err);
    return redirect(res, "/login?google_error=" + encodeURIComponent("No pudimos conectar con Google. Probá de nuevo."));
  }
}

function startFlow(res) {
  // State firmado y con expiración corta: no hace falta guardarlo en ningún
  // lado, con verificar la firma al volver alcanza para el anti-CSRF.
  const state = signPayload({ n: crypto.randomBytes(8).toString("hex"), exp: Math.floor(Date.now() / 1000) + 600 });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

async function finishFlow(res, code, state) {
  if (!verifyToken(state)) {
    return redirect(res, "/login?google_error=" + encodeURIComponent("El enlace de Google venció, probá de nuevo."));
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
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
