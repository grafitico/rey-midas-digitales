// RESCATE DE UN SOLO USO (noviembre 2026) — borrar este archivo cuando termine.
//
// Al mudar el sitio de Vercel a Banahosting no se pudo copiar ACCOUNT_SECRET:
// Vercel lo guarda como variable "sensible" y no deja verla nunca más. Con esa
// clave están cifradas las contraseñas y códigos de verificación de las cuentas
// PSN/Xbox vendidas (tabla purchases, ver encryptSecret en _lib.js).
//
// Vercel sí puede USAR la clave vieja aunque no la muestre. Este endpoint corre
// en Vercel y re-cifra cada valor con la clave NUEVA (NEW_ACCOUNT_SECRET, la
// misma que se cargó como ACCOUNT_SECRET en la app Node.js de Banahosting).
//
// Uso (en el navegador, sobre el dominio *.vercel.app del proyecto):
//   /api/rescate-cuentas?token=<RESCATE_TOKEN>            → solo cuenta (no cambia nada)
//   /api/rescate-cuentas?token=<RESCATE_TOKEN>&aplicar=1  → re-cifra y guarda
// Se puede correr varias veces: lo que ya tiene la clave nueva se salta.
// Variables necesarias en Vercel: ACCOUNT_SECRET (la vieja, ya está),
// NEW_ACCOUNT_SECRET y RESCATE_TOKEN. Sin RESCATE_TOKEN responde 404.

import crypto from "crypto";
import { sb, checkConfig } from "./_lib.js";

const ENC_PREFIX = "enc:v1:";
const FIELDS = ["account_password", "verifier_codes"];
const PAGE = 500;

const keyFrom = (s) => crypto.createHash("sha256").update(s).digest();

function decryptWith(key, value) {
  const buf = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

// Mismo formato que encryptSecret() de _lib.js.
function encryptWith(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function tokenOk(given, expected) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.RESCATE_TOKEN;
  if (!expected) return res.status(404).json({ error: "No encontrado" });
  if (!tokenOk(req.query.token, expected)) return res.status(403).json({ error: "Token incorrecto" });

  const oldSecret = process.env.ACCOUNT_SECRET;
  const newSecret = process.env.NEW_ACCOUNT_SECRET;
  if (!oldSecret || !newSecret) {
    return res.status(500).json({ error: "Faltan ACCOUNT_SECRET (vieja) o NEW_ACCOUNT_SECRET (nueva) en Vercel." });
  }
  if (oldSecret === newSecret) return res.status(400).json({ error: "La clave nueva es igual a la vieja." });
  const oldKey = keyFrom(oldSecret), newKey = keyFrom(newSecret);
  const aplicar = req.query.aplicar === "1";

  try {
    checkConfig();
    const stats = { filas: 0, valores: 0, recifrados: 0, yaConClaveNueva: 0, fallidos: 0, idsFallidos: [] };
    const filter = `or=(${FIELDS.map(f => `${f}.like.${ENC_PREFIX}*`).join(",")})`;
    for (let offset = 0; ; offset += PAGE) {
      const rows = await sb(`purchases?select=id,${FIELDS.join(",")}&${filter}&order=id.asc&limit=${PAGE}&offset=${offset}`);
      if (!rows || !rows.length) break;
      for (const row of rows) {
        stats.filas++;
        const patch = {};
        for (const f of FIELDS) {
          const v = row[f];
          if (typeof v !== "string" || !v.startsWith(ENC_PREFIX)) continue;
          stats.valores++;
          try {
            patch[f] = encryptWith(newKey, decryptWith(oldKey, v));
          } catch {
            try { decryptWith(newKey, v); stats.yaConClaveNueva++; }
            catch { stats.fallidos++; if (stats.idsFallidos.length < 50) stats.idsFallidos.push(row.id); }
          }
        }
        if (Object.keys(patch).length) {
          stats.recifrados += Object.keys(patch).length;
          if (aplicar) {
            await sb(`purchases?id=eq.${encodeURIComponent(row.id)}`, {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify(patch),
            });
          }
        }
      }
      if (rows.length < PAGE) break;
    }
    return res.status(200).json({
      modo: aplicar ? "APLICADO: valores re-cifrados con la clave nueva" : "PRUEBA: no se cambió nada (agregá &aplicar=1 para aplicar)",
      ...stats,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
