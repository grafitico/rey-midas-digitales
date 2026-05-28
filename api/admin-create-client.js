// Crea una cuenta de cliente con email + contraseña.
// Solo accesible por admins (verificado por JWT contra la tabla profiles).
// Necesita las env vars en Vercel:
//   - NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL)
//   - SUPABASE_SERVICE_ROLE_KEY (¡secreto, server-side only!)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: "Servidor no configurado (faltan env vars)." });
  }

  // 1) Verificar que el caller es admin
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sin token" });

  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
  });
  if (!userRes.ok) return res.status(401).json({ error: "Token inválido" });
  const user = await userRes.json();

  // Chequear flag is_admin en profiles
  const profRes = await fetch(
    `${url}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const profArr = await profRes.json();
  if (!Array.isArray(profArr) || !profArr[0]?.is_admin) {
    return res.status(403).json({ error: "Solo admins pueden crear cuentas" });
  }

  // 2) Validar payload
  const { email, password, full_name } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Email y contraseña (6+ caracteres) son requeridos" });
  }

  // 3) Crear el usuario con la Admin API
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true, // saltea verificación por email
      user_metadata: full_name ? { full_name } : {},
    }),
  });
  const data = await createRes.json();
  if (!createRes.ok) {
    return res.status(createRes.status).json({ error: data.msg || data.error_description || data.error || "Error creando usuario" });
  }

  // 4) Si pusieron full_name, actualizar el profile también
  if (full_name && data.id) {
    await fetch(
      `${url}/rest/v1/profiles?id=eq.${data.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ full_name }),
      }
    );
  }

  return res.status(200).json({ id: data.id, email: data.email });
}
