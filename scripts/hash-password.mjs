// Genera el hash de una contraseña en el MISMO formato que usa la web
// (scrypt$salt$hash), para resetear el acceso de un usuario directamente
// desde Supabase cuando se olvidó la contraseña.
//
// Uso:
//   node scripts/hash-password.mjs "miNuevaClaveSegura"
//
// Copiá la línea que empieza con "scrypt$" y pegala en Supabase:
//   Table Editor → app_users → fila de tu admin → columna password_hash → Save.

import crypto from "crypto";

const password = process.argv[2];
if (!password || password.length < 6) {
  console.error("Pasá una contraseña de al menos 6 caracteres entre comillas.");
  console.error('Ejemplo: node scripts/hash-password.mjs "MiClave123"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
const stored = `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;

console.log("\nPegá ESTE valor en la columna password_hash de tu usuario en Supabase:\n");
console.log(stored);
console.log("");
