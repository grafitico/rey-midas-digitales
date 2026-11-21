// Arma dist/ con SOLO los archivos públicos del sitio, y dist-api/ con la app
// Node.js de las funciones, para subirlos a Banahosting (Apache + FTP). Lo usa
// .github/workflows/deploy-banahosting.yml después de `npm run build`.
//
// Vercel servía la raíz del repo tal cual y ejecutaba api/ y middleware.js
// como funciones. En un hosting compartido eso no existe: se sube solo lo
// estático, más deploy/.htaccess, que hace lo que hacía vercel.json (rutas de
// la tienda, redirecciones, cabeceras, caché).

import crypto from "crypto";
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

// Lo que NO se publica: código de servidor, scripts internos, docs y datos
// que solo usan los robots de GitHub.
const EXCLUDE = new Set([
  ".git", ".github", ".gitignore", "node_modules", "dist", "dist-api", "deploy",
  "api", "server", "scripts", "migrations", "telegram-userbot", "searcade",
  "middleware.js", "vercel.json", "package.json", "package-lock.json",
  "ps-rescate-ediciones.json",
]);
const EXCLUDE_EXT = new Set([".md", ".sql"]);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

let files = 0, bytes = 0;
function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst);
    files++; bytes += st.size;
  }
}

for (const name of fs.readdirSync(ROOT)) {
  if (EXCLUDE.has(name) || EXCLUDE_EXT.has(path.extname(name).toLowerCase())) continue;
  copy(path.join(ROOT, name), path.join(DIST, name));
}
copy(path.join(ROOT, "deploy", ".htaccess"), path.join(DIST, ".htaccess"));
// Índice chico para la vista previa de WhatsApp/Facebook (api/og.js): así la
// app Node.js no lee ps-catalog.json (11 MB), que la hacía pasar el tope de
// memoria del hosting.
{
  const { buildGamesIndex } = await import("../api/og.js");
  const read = name => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8")); } catch { return null; } };
  const games = buildGamesIndex(read);
  const json = JSON.stringify({ generated: new Date().toISOString(), games });
  fs.writeFileSync(path.join(DIST, "og-index.json"), json);
  console.log(`[build-dist] og-index.json: ${Object.keys(games).length} juegos, ${(json.length / 1024 / 1024).toFixed(1)} MB`);
}
// Marca visible para saber qué hosting está respondiendo: reymidascr.com/hosting.txt
// solo existe en Banahosting (Vercel devolvería la tienda en esa ruta).
fs.writeFileSync(path.join(DIST, "hosting.txt"), `Banahosting — publicado ${new Date().toISOString()} (${(process.env.GITHUB_SHA || "local").slice(0, 7)})\n`);

console.log(`[build-dist] ${files} archivos, ${(bytes / 1024 / 1024).toFixed(1)} MB en dist/`);

// ---- dist-api/: la app Node.js de cPanel (~/rey-midas-api) ----
// Las funciones de api/ + el adaptador server/ + lo que leen del disco.
const DIST_API = path.join(ROOT, "dist-api");
fs.rmSync(DIST_API, { recursive: true, force: true });
fs.mkdirSync(DIST_API);
files = 0; bytes = 0;
for (const name of ["api", "server", "featured-games.json", "middleware.js"]) copy(path.join(ROOT, name), path.join(DIST_API, name));
// api/*.js son módulos ES: Node necesita "type": "module". Sin dependencias,
// así que no hace falta npm install en el servidor.
fs.writeFileSync(path.join(DIST_API, "package.json"), JSON.stringify({ name: "rey-midas-api", private: true, type: "module" }, null, 2) + "\n");
// Passenger reinicia la app cuando cambia tmp/restart.txt. Su contenido es una
// huella de los archivos de la app: cambia (y la app se reinicia) solo cuando
// cambia el código, no en cada publicación de precios o catálogos. Antes llevaba
// la hora y la app se reiniciaba ~8 veces por día; cada reinicio dejaba una
// copia vieja esperando consultas colgadas, y en 4 días se juntaron ~100
// procesos: el tope de la cuenta (caía la API y también apk.reymidascr.com).
{
  const hash = crypto.createHash("sha256");
  const walk = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else hash.update(path.relative(DIST_API, full)).update(fs.readFileSync(full));
    }
  };
  walk(DIST_API);
  fs.mkdirSync(path.join(DIST_API, "tmp"));
  fs.writeFileSync(path.join(DIST_API, "tmp", "restart.txt"), `${hash.digest("hex").slice(0, 16)}\n`);
}
console.log(`[build-dist] ${files} archivos en dist-api/ (app Node.js)`);
