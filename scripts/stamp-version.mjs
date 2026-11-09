// Sella una versión NUEVA en cada build.
//
// Por qué existe: vercel.json sirve app.js / style.css con
// "Cache-Control: max-age=31536000, immutable" (un año, y con `immutable` el
// navegador ni siquiera revalida). Lo único que hace que un visitante recurrente
// baje el archivo nuevo es que cambie la URL, es decir el "?v=..." de
// index.html. Ese valor se venía editando a mano y se olvidaba: el 25/08/2026
// seguía en "20260722e", así que varios despliegues de código nuevo NO le
// llegaban a nadie que ya hubiera entrado antes — se quedaban con el JS viejo
// cacheado y parecía que los cambios no se habían aplicado.
//
// Ahora corre dentro de `npm run build`, así que la versión se renueva sola en
// cada despliegue. Sella:
//   - index.html          → ?v=<version> de app.js, style.css, pwa.js y chat-widget.js
//   - service-worker.js   → CACHE_VERSION (invalida también la caché del PWA)
//
// La versión es un hash del contenido del código (ver buildVersion): cambia
// solo cuando cambia el código, no con cada commit de datos de los robots.

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.join(import.meta.dirname, "..");

// La versión sale del CONTENIDO del código del sitio (no del commit): los
// robots de precios y catálogos publican varias veces al día sin tocar el
// código, y con el commit cada publicación era "versión nueva" → el service
// worker se reinstalaba y a todos les salía el aviso de actualizar.
function buildVersion() {
  const files = ["index.html", "app.js", "style.css", "pwa.js", "chat-widget.js", "service-worker.js", "manifest.webmanifest"];
  const h = crypto.createHash("sha256");
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
    // Quitar lo que este mismo script sella, para que el hash no dependa de él.
    txt = txt.replace(/\?v=[A-Za-z0-9._-]*/g, "?v=").replace(/const CACHE_VERSION = ['"][^'"]*['"];/, "");
    h.update(f + "\0" + txt + "\0");
  }
  return h.digest("hex").slice(0, 12);
}

const version = buildVersion();
let touched = 0;

// ---- index.html: ?v= de cada asset versionado ----
const indexPath = path.join(ROOT, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const before = html;
html = html.replace(
  /(\/(?:app|pwa|chat-widget)\.js|\/style\.css)\?v=[^"']*/g,
  (_m, file) => `${file}?v=${version}`
);
if (html !== before) {
  fs.writeFileSync(indexPath, html);
  touched++;
}

// ---- service-worker.js: CACHE_VERSION ----
const swPath = path.join(ROOT, "service-worker.js");
let sw = fs.readFileSync(swPath, "utf8");
const swBefore = sw;
sw = sw.replace(/const CACHE_VERSION = ['"][^'"]*['"];/, `const CACHE_VERSION = 'v1-${version}';`);
if (sw !== swBefore) {
  fs.writeFileSync(swPath, sw);
  touched++;
}

const stamped = [...html.matchAll(/\/(?:app|pwa|chat-widget)\.js\?v=([^"']*)|\/style\.css\?v=([^"']*)/g)].length;
console.log(`[stamp-version] versión ${version} — ${stamped} assets sellados en index.html, ${touched} archivo(s) actualizado(s).`);

if (!stamped) {
  console.error("[stamp-version] AVISO: no se selló ningún asset. ¿Cambiaron las rutas en index.html?");
  process.exit(1);
}
