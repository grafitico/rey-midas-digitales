# Notas para Claude

## Flujo de trabajo

- **Mergear a `main` sin preguntar.** Cuando el trabajo esté terminado y
  verificado, mergealo a `main` y hacé push. No hace falta pedir permiso ni
  abrir un PR para esperar aprobación. (Indicación del dueño, 27/08/2026.)
- Antes de mergear, dejá el trabajo verificado: los cambios de front se prueban
  en el navegador y los de `api/` con sus propias pruebas, no solo leyendo el
  código.
- Desde noviembre 2026 el sitio vive en **Banahosting** (cPanel, ya no en
  Vercel). Un push a `main` sale a producción: el workflow
  `.github/workflows/deploy-banahosting.yml` hace `npm run build`, arma `dist/`
  (tienda estática) y `dist-api/` (funciones) con `scripts/build-dist.mjs` y los
  sube por FTP. También corre al terminar cada robot de datos (precios,
  catálogos, bundles), porque sus commits no disparan workflows por sí solos.
  Los `?v=` de `index.html` y la caché del PWA los renueva solo `npm run build`
  (ver `scripts/stamp-version.mjs`): no hay que tocarlos a mano.
- Hosting: la tienda va a `~/reymidascr.com` (Apache; `deploy/.htaccess` hace lo
  que hacía `vercel.json`). `/api/*` lo atiende la app Node.js de cPanel ("Setup
  Node.js App", Node 20, raíz `~/rey-midas-api`, arranque `server/start.cjs`):
  `server/app.mjs` imita la interfaz de Vercel para que `api/*.js` corra igual.
  Las claves (Supabase, Google, Groq…) son variables de entorno de esa app en
  cPanel. `https://reymidascr.com/hosting.txt` dice qué versión está publicada.
- **Tope de procesos de Banahosting (caída del 14/11/2026):** la cuenta comparte
  memoria y procesos con todos sus sitios (apk.reymidascr.com, agrologos, etc.).
  Se acumularon ~100 procesos de copias viejas de la app Node.js y se cayó toda
  la API y también apk ("cagefs_enter: Unable to fork… resource limits"). Para
  que no se repita: `restart.txt` solo cambia cuando cambia el código de la API
  (huella en `scripts/build-dist.mjs`), toda llamada externa corta a los 12 s y
  toda consulta a los 30 s, las copias viejas se cierran solas
  (`server/app.mjs`) y la vista previa usa `og-index.json` en vez del catálogo
  de 11 MB. No agregar `setInterval` sin `.unref()` ni conexiones que queden
  abiertas. El robot `vigilar-api.yml` avisa por correo si la API no responde.
  Si vuelve a pasar: cPanel → Setup Node.js App → Restart; si no deja, ticket a
  Banahosting para que termine los procesos.
- DNS: el dominio usa los servidores de **Cloudflare** (no los de Banahosting);
  los registros se cambian en dash.cloudflare.com, no en el editor de zonas de
  cPanel.
- Los precios en vivo NO se calculan en el servidor: los robots de GitHub
  generan `ps-prices.json` y `featured-prices.json` cada 3 h. Las funciones
  `/api/scrape` y `/api/featured-prices` agotaron la CPU del plan gratis de
  Vercel y Vercel pausó el sitio; no volver a llamarlas desde la web.
- La base de datos es Supabase; su organización la creó la integración de
  Vercel, así que no borrar la cuenta/proyecto de Vercel sin antes sacar el
  proyecto de Supabase de ahí.

## Asistente Midas

- El cerebro vive en `api/chat.js` y el widget en `chat-widget.js`.
- Los proveedores retiran modelos cada tanto y eso deja el chat mudo. El
  diagnóstico rápido es `https://reymidascr.com/api/chat?selftest`, y los fallos
  quedan en el log de la app Node.js de cPanel (`~/rey-midas-api/stderr.log`,
  o el de Passenger) con el prefijo `[chat]`.
- El catálogo viaja dentro del prompt en cada consulta: agrandar
  `featured-games.json` sale caro en cuota. Ver `ASISTENTE-IA-SETUP.md`.
