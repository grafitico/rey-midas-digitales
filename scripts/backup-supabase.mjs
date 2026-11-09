// Copia de seguridad de la base de datos (Supabase) → archivo comprimido y CIFRADO.
//
// Supabase en plan gratis no guarda respaldos ("Last backup: No backups").
// Este script lo corre .github/workflows/backup-supabase.yml una vez al día:
// descarga todas las tablas por la API REST, las comprime (gzip) y las cifra
// con AES-256-GCM usando una frase secreta (BACKUP_PASSPHRASE). El archivo se
// sube por FTP a una carpeta privada de Banahosting (no a GitHub: el repo es
// público).
//
// Uso:
//   node scripts/backup-supabase.mjs                      → crea backups/supabase-AAAA-MM-DD.json.gz.enc
//   node scripts/backup-supabase.mjs --decrypt <archivo>  → imprime el JSON descifrado
// Variables: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// BACKUP_PASSPHRASE. Sin la frase secreta NO se puede recuperar ninguna copia.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const MAGIC = Buffer.from("RMDBK1");
const PAGE = 1000;
// Si la API no lista las tablas, se respaldan al menos estas (las que usa api/).
const KNOWN_TABLES = ["app_users", "purchases", "newsletter_subscribers", "page_views"];

const passphrase = process.env.BACKUP_PASSPHRASE;
if (!passphrase || passphrase.length < 16) {
  console.error("[backup] Falta BACKUP_PASSPHRASE (mínimo 16 caracteres).");
  process.exit(1);
}

function encrypt(plain) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ct]);
}

function decrypt(buf) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("No es una copia de Rey Midas (RMDBK1).");
  let o = MAGIC.length;
  const salt = buf.subarray(o, o += 16), iv = buf.subarray(o, o += 12), tag = buf.subarray(o, o += 16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(o)), d.final()]);
}

if (process.argv[2] === "--decrypt") {
  const file = process.argv[3];
  if (!file) { console.error("Uso: node scripts/backup-supabase.mjs --decrypt <archivo>"); process.exit(1); }
  let plain;
  try {
    plain = zlib.gunzipSync(decrypt(fs.readFileSync(file)));
  } catch (e) {
    console.error(`[backup] No se pudo descifrar (¿frase secreta correcta?): ${e.message}`);
    process.exit(1);
  }
  // Salir recién cuando terminó de escribirse todo: un process.exit() inmediato
  // cortaba la salida a medias cuando va a un archivo o a otro programa.
  process.stdout.write(plain, () => process.exit(0));
  await new Promise(() => {});
}

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("[backup] Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function listTables() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { ...headers, Accept: "application/openapi+json" } });
    if (r.ok) {
      const spec = await r.json();
      const names = Object.keys(spec.definitions || {}).filter(n => !n.startsWith("rpc"));
      if (names.length) return [...new Set([...names, ...KNOWN_TABLES])];
    }
  } catch {}
  return KNOWN_TABLES;
}

async function dumpTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers: { ...headers, "Range-Unit": "items", Range: `${from}-${from + PAGE - 1}` },
    });
    if (r.status === 404) return null; // la tabla no existe
    if (r.status === 416) break;       // pidió más allá del final (la tabla tenía un múltiplo exacto de PAGE)
    if (!r.ok && r.status !== 206) throw new Error(`${table}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

const tables = await listTables();
const data = {};
for (const t of tables) {
  const rows = await dumpTable(t);
  if (rows === null) continue;
  data[t] = rows;
  console.log(`[backup] ${t}: ${rows.length} filas`);
}

// Salvaguarda: si no vino ningún usuario, algo está mal configurado y la copia no sirve.
if (!data.app_users || data.app_users.length === 0) {
  console.error("[backup] app_users vino vacía: probable clave o URL incorrecta. No se guarda la copia.");
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const json = JSON.stringify({ createdAt: new Date().toISOString(), source: SUPABASE_URL, tables: data });
const out = encrypt(zlib.gzipSync(json, { level: 9 }));
fs.mkdirSync("backups", { recursive: true });
const file = path.join("backups", `supabase-${date}.json.gz.enc`);
fs.writeFileSync(file, out);
// Prueba de que se puede abrir: descifrar y comparar antes de darla por buena.
if (zlib.gunzipSync(decrypt(out)).toString() !== json) {
  console.error("[backup] La copia cifrada no se pudo verificar.");
  process.exit(1);
}
console.log(`[backup] OK: ${file} (${(out.length / 1024).toFixed(1)} KB cifrados, ${Object.keys(data).length} tablas)`);
