// Arma dist/ con SOLO los archivos públicos del sitio, para subirlos al
// hosting tradicional (Banahosting, Apache + FTP). Lo usa
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
  ".git", ".github", ".gitignore", "node_modules", "dist", "deploy",
  "api", "scripts", "migrations", "telegram-userbot",
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
