// Arma dist/ con SOLO los archivos públicos del sitio, y dist-api/ con la app
// Node.js de las funciones, para subirlos a Banahosting (Apache + FTP). Lo usa
// .github/workflows/deploy-banahosting.yml después de `npm run build`.
//
// Vercel servía la raíz del repo tal cual y ejecutaba api/ y middleware.js
// como funciones. En un hosting compartido eso no existe: se sube solo lo
// estático, más deploy/.htaccess, que hace lo que hacía vercel.json (rutas de
// la tienda, redirecciones, cabeceras, caché).

import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

// Lo que NO se publica: código de servidor, scripts internos, docs y datos
// que solo usan los robots de GitHub.
const EXCLUDE = new Set([
  ".git", ".github", ".gitignore", "node_modules", "dist", "dist-api", "deploy",
  "api", "server", "scripts", "migrations", "telegram-userbot",
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

console.log(`[build-dist] ${files} archivos, ${(bytes / 1024 / 1024).toFixed(1)} MB en dist/`);

// ---- dist-api/: la app Node.js de cPanel (~/rey-midas-api) ----
// Las funciones de api/ + el adaptador server/ + lo que leen del disco.
const DIST_API = path.join(ROOT, "dist-api");
fs.rmSync(DIST_API, { recursive: true, force: true });
fs.mkdirSync(DIST_API);
files = 0; bytes = 0;
for (const name of ["api", "server", "featured-games.json"]) copy(path.join(ROOT, name), path.join(DIST_API, name));
// api/*.js son módulos ES: Node necesita "type": "module". Sin dependencias,
// así que no hace falta npm install en el servidor.
fs.writeFileSync(path.join(DIST_API, "package.json"), JSON.stringify({ name: "rey-midas-api", private: true, type: "module" }, null, 2) + "\n");
// Passenger reinicia la app cuando cambia tmp/restart.txt: un valor nuevo en
// cada despliegue hace que tome el código recién subido.
fs.mkdirSync(path.join(DIST_API, "tmp"));
fs.writeFileSync(path.join(DIST_API, "tmp", "restart.txt"), `${process.env.GITHUB_SHA || ""} ${new Date().toISOString()}\n`);
console.log(`[build-dist] ${files} archivos en dist-api/ (app Node.js)`);
