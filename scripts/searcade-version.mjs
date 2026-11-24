// Pone ?v=<versión> a los .js y .css propios en los HTML de SEARCADE, para que
// Cloudflare y los navegadores no sigan sirviendo una copia vieja después de
// publicar. Lo corre .github/workflows/deploy-searcade.yml antes de subir.
//
// Uso: node scripts/searcade-version.mjs <carpeta> <versión>

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
