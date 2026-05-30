// Cache-busting automático para Vercel.
//
// En cada deploy, Vercel ejecuta este script (ver "buildCommand" en
// vercel.json). Reescribe el query string ?v=... de app.js y style.css en
// index.html con un identificador único del deploy (el hash corto del commit
// que provee Vercel, o un timestamp si no está disponible).
//
// Resultado: cada deploy sirve los archivos bajo una URL distinta, así que
// los browsers y el CDN nunca entregan una versión vieja en caché. Ya no hay
// que subir el número de versión a mano.
//
// Importante: este script NUNCA lanza error. Si algo falla, deja index.html
// como está para que el deploy no se caiga por el cache-busting.

import { readFileSync, writeFileSync } from "node:fs";

const buildId =
  (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || String(Date.now());

try {
  const file = "index.html";
  const before = readFileSync(file, "utf8");
  // Reemplaza el valor que sigue a app.js?v= o style.css?v= (hasta la comilla).
  const after = before.replace(
    /((?:app\.js|style\.css)\?v=)[^"'#]+/g,
    `$1${buildId}`
  );
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[build] cache-bust aplicado: ?v=${buildId}`);
  } else {
    console.log("[build] no se encontró ?v= para reemplazar (sin cambios)");
  }
} catch (e) {
  console.error("[build] cache-bust omitido:", e.message);
  // No relanzamos: el deploy no debe fallar por esto.
}
