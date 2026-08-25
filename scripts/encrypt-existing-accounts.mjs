// Cifra las filas de `purchases` que TODAVÍA tienen account_password/
// verifier_codes en texto plano (guardadas antes de configurar
// ACCOUNT_SECRET). Correr UNA VEZ después de:
//   1) agregar ACCOUNT_SECRET en Vercel → Settings → Environment Variables
//   2) hacer Redeploy
//
// Uso (con las mismas env vars que usa Vercel en producción):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ACCOUNT_SECRET=... \
//     node scripts/encrypt-existing-accounts.mjs
//
// Es seguro correrlo más de una vez: las filas ya cifradas (prefijo "enc:v1:")
// se saltean.

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACCOUNT_SECRET = process.env.ACCOUNT_SECRET;

if (!SUPABASE_URL || !SERVICE_KEY || !ACCOUNT_SECRET) {
  console.error("Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o ACCOUNT_SECRET en el entorno.");
  console.error("Corré este script con las mismas env vars que tenés en Vercel.");
  process.exit(1);
}

const ACCOUNT_KEY = crypto.createHash("sha256").update(ACCOUNT_SECRET).digest();
const ENC_PREFIX = "enc:v1:";

function encryptSecret(plain) {
  if (plain == null || plain === "") return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ACCOUNT_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

async function sb(path, options = {}) {
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
  if (!res.ok) throw new Error(data?.message || `Supabase error ${res.status}`);
  return data;
}

async function main() {
  const rows = await sb("purchases?select=id,account_password,verifier_codes");
  let updated = 0, skipped = 0;

  for (const row of rows) {
    const needsPassword = row.account_password && !String(row.account_password).startsWith(ENC_PREFIX);
    const needsCodes = row.verifier_codes && !String(row.verifier_codes).startsWith(ENC_PREFIX);
    if (!needsPassword && !needsCodes) { skipped++; continue; }

    const patch = {};
    if (needsPassword) patch.account_password = encryptSecret(row.account_password);
    if (needsCodes) patch.verifier_codes = encryptSecret(row.verifier_codes);

    await sb(`purchases?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    updated++;
  }

  console.log(`Listo: ${updated} fila(s) cifrada(s), ${skipped} ya estaban cifradas o vacías.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
