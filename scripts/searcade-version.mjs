// Pone ?v=<versión> a los .js y .css propios en los HTML de SEARCADE, para que
// Cloudflare y los navegadores no sigan sirviendo una copia vieja después de
// publicar. Lo corre .github/workflows/deploy-searcade.yml antes de subir.
//
// Uso: node scripts/searcade-version.mjs <carpeta> <versión>

import crypto from "crypto";
import fs from "fs";
import path from "path";

const [dir = "searcade", version = Date.now().toString(36)] = process.argv.slice(2);
const v = String(version).replace(/[^\w.-]/g, "").slice(0, 20);
let cambios = 0;
for (const nombre of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const archivo = path.join(dir, nombre);
  const antes = fs.readFileSync(archivo, "utf8");
  // Solo rutas locales (sin http ni //) que terminan en .js o .css, con o sin ?v= previo
  const despues = antes.replace(/((?:src|href)=")(?!https?:|\/\/)([^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")/g, (_, a, ruta, b) => {
    cambios++;
    return `${a}${ruta}?v=${v}${b}`;
  });
  if (despues !== antes) fs.writeFileSync(archivo, despues);
}
console.log(`[searcade-version] ${cambios} referencias con ?v=${v}`);

// Fotos de img/ que se piden desde config.js y styles.css: ?v=<huella del
// archivo>, así una foto reemplazada con el mismo nombre (p. ej. la espalda de
// la camiseta) se ve al instante pese a la caché de 7 días, y las que no
// cambian siguen en caché.
const huellas = new Map();
const huellaDe = (ruta) => {
  if (!huellas.has(ruta)) {
    const f = path.join(dir, ruta);
    huellas.set(ruta, fs.existsSync(f) ? crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 8) : null);
  }
  return huellas.get(ruta);
};
let fotos = 0;
for (const nombre of ["config.js", "styles.css"]) {
  const archivo = path.join(dir, nombre);
  if (!fs.existsSync(archivo)) continue;
  const antes = fs.readFileSync(archivo, "utf8");
  const despues = antes.replace(/(["'(])((?:img|audio)\/[^"'()?#\s]+\.(?:webp|png|jpe?g|svg|avif|mp3|m4a|ogg))(?:\?v=[^"')]*)?(?=["')])/g, (todo, a, ruta) => {
    const h = huellaDe(ruta);
    if (!h) return todo;
    fotos++;
    return `${a}${ruta}?v=${h}`;
  });
  if (despues !== antes) fs.writeFileSync(archivo, despues);
}
console.log(`[searcade-version] ${fotos} fotos con ?v=<huella>`);
