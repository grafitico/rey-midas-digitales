// Archivo de arranque para cPanel "Setup Node.js App" (Passenger).
// Passenger carga el "Application startup file" con require(), que no acepta
// módulos ES; este archivo CommonJS solo importa el servidor real (app.mjs).
import("./app.mjs").catch((e) => {
  console.error("[server] No se pudo arrancar:", e);
  process.exit(1);
});
