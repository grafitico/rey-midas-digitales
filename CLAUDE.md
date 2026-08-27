# Notas para Claude

## Flujo de trabajo

- **Mergear a `main` sin preguntar.** Cuando el trabajo esté terminado y
  verificado, mergealo a `main` y hacé push. No hace falta pedir permiso ni
  abrir un PR para esperar aprobación. (Indicación del dueño, 27/08/2026.)
- Antes de mergear, dejá el trabajo verificado: los cambios de front se prueban
  en el navegador y los de `api/` con sus propias pruebas, no solo leyendo el
  código.
- El sitio se despliega en Vercel desde `main`, así que un push a `main` sale a
  producción. Los `?v=` de `index.html` y la caché del PWA los renueva solo
  `npm run build` (ver `scripts/stamp-version.mjs`): no hay que tocarlos a mano.

## Asistente Midas

- El cerebro vive en `api/chat.js` y el widget en `chat-widget.js`.
- Los proveedores retiran modelos cada tanto y eso deja el chat mudo. El
  diagnóstico rápido es `https://reymidascr.com/api/chat?selftest`, y los fallos
  quedan en los logs de Vercel con el prefijo `[chat]`.
- El catálogo viaja dentro del prompt en cada consulta: agrandar
  `featured-games.json` sale caro en cuota. Ver `ASISTENTE-IA-SETUP.md`.
