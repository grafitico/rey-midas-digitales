// Índice de carátulas alojadas en Bana Hosting.
// ============================================
// covers.json vive en el repo (lo escribe el cosechador en GitHub Actions) y
// mapea  id-de-juego → URL pública de la imagen en Bana. Lo leemos del MISMO
// origen (/covers.json) porque la CSP del sitio solo permite connect-src 'self';
// las imágenes en sí pueden venir de cualquier https (img-src https:).
//
// Uso desde app.js:
//   import { initBanaCovers, getCoverUrl } from "./bana-covers.js";
//   await initBanaCovers();              // una vez, al cargar
//   const url = getCoverUrl(game.id);    // síncrono, "" si no existe

let covers = {};
let ready = false;

export async function initBanaCovers() {
  if (ready) return covers;
  try {
    const res = await fetch("/covers.json", { cache: "force-cache" });
    if (res.ok) {
      const data = await res.json();
      covers = data.covers || {};
      console.log(`[Bana] ${Object.keys(covers).length} carátulas indexadas`);
    }
  } catch (e) {
    console.log("[Bana] covers.json no disponible, se usa RAWG:", e.message);
  }
  ready = true;
  // Exponer global para lookups síncronos rápidos desde app.js.
  window.__BANA_COVERS = covers;
  return covers;
}

export function getCoverUrl(gameId) {
  return covers[gameId] || "";
}
