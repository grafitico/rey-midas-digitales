# Auditoría de reymidascr.com — noviembre 2026 (post-mudanza a Banahosting)

Fecha: 9 de noviembre de 2026.

**Cómo se hizo:** desde el entorno de trabajo no se puede abrir reymidascr.com
(la red lo bloquea), así que se auditó una réplica exacta de lo publicado: el
sitio armado igual que el robot de publicación (`npm run build` +
`scripts/build-dist.mjs`), servido por Apache con el mismo `deploy/.htaccess`.
Se midió con Lighthouse (celular simulado), Chrome DevTools (perfil de CPU,
4G lento + CPU 4x), pruebas de navegador en 20 páginas a 360 px, revisión de
código de `api/` y del historial de los robots de GitHub. Las imágenes
externas (PSN, RAWG, Microsoft) no cargan en ese entorno: los errores de
consola y la nota de "Buenas prácticas" que salen de eso no aplican al sitio real.

## Resumen

La mudanza quedó sana: tienda, combo, carrito por WhatsApp, login con Google,
registro, chat, panel admin y cuentas vendidas funcionan desde Banahosting, y
la publicación es automática. El problema grande era de **velocidad en
celulares**: la página quedaba bloqueada 33–43 s procesando el catálogo. Eso
ya se corrigió en esta auditoría. Lo que más urge ahora es **tener copias de
seguridad de la base de datos** y **aligerar el catálogo**.

## Corregido durante la auditoría (ya publicado)

| Problema | Causa | Resultado |
|---|---|---|
| Celular bloqueado 33–43 s en inicio y PS5/PS4/Xbox | `priorityScore()` se recalculaba en cada comparación al ordenar ~9.000 juegos | Bloqueo baja a ~2 s |
| Pintar la grilla era lento | `formatCRC()` creaba un formateador de moneda por cada precio | Un solo formateador |
| El pie de página saltaba al aparecer la grilla (CLS) | `#app` sin alto mínimo mientras carga | CLS 1,03 → 0,10 (PS5); 0,83 → 0,004 (combo) |

Lighthouse, celular simulado (antes → después):

| Página | Velocidad | Tiempo bloqueado | CLS | Accesibilidad | SEO |
|---|---|---|---|---|---|
| Inicio | 36 → 44 | 33,4 s → 2,7 s | 0,004 | 96 | 92 |
| PS5 | 11 → 40 | 43,8 s → 2,3 s | 0,93 → 0,10 | 100 | 92 |
| Combo | 36 → 48 | 2,0 s → 2,4 s | 0,83 → 0,004 | 95 | 92 |

## Pendientes, por prioridad

### Alta

1. **Sin copias de seguridad de la base de datos.** Supabase (plan gratis)
   muestra "Last backup: No backups". Si se borra o corrompe algo (clientes,
   compras, Cofre, cuentas vendidas) no hay cómo recuperarlo.
   *Solución:* robot de GitHub que haga una copia diaria (exportar tablas a un
   archivo cifrado) y guarde las últimas N. Esfuerzo: bajo.

2. **Catálogo pesado: el combo tarda ~16 s en 4G lento.** Cada visitante baja
   ~2 MB comprimidos (`ps-catalog.json` 1,4 MB, `ps-prices.json` 0,27 MB,
   `xbox-catalog.json` 0,2 MB). En un celular con 4G lento: primer contenido
   ~2 s, catálogo completo 18–24 s; el combo no muestra nada hasta tenerlo.
   *Solución:* quitar del catálogo campos que se pueden calcular o que van
   vacíos (`url`, `isBundle`, `discount`, `onSale`, `releaseDate`,
   `ageRating`, `comingSoon`); generar un archivo chico solo con los juegos
   que caben en los combos para que el combo cargue en segundos. Esfuerzo: medio.

3. **Se perdió la vista previa al compartir por WhatsApp/Facebook.** En
   Vercel, `middleware.js` le armaba a los robots de WhatsApp/Facebook/Google
   una vista previa con la foto, el nombre y el precio de cada juego. En
   Banahosting no corre: al compartir un juego sale la vista previa genérica
   de la tienda.
   *Solución:* llevar esa lógica a la app Node.js y que `.htaccess` mande ahí
   solo a esos robots. Esfuerzo: medio.

### Media

4. **El chat no tiene límite de uso.** `/api/chat` limita el largo de los
   mensajes pero no cuántas veces se puede llamar. Alguien podría gastar el
   cupo gratis de Groq (y procesos del hosting) en minutos.
   *Solución:* límite por visitante (p. ej. 20 mensajes por hora por IP).
   Esfuerzo: bajo.

5. **Enriquecimiento con RAWG: ~150–240 llamadas por visitante nuevo.** La web
   busca puntaje/portada de cientos de juegos por cada visitante. Hoy no pasa
   porque falta `RAWG_API_KEY` (el servidor contesta "cupo agotado" y la
   página deja de preguntar), pero **si se carga esa clave, el cupo de RAWG
   (20.000/mes) se agota con ~100 visitas** y el hosting recibe cientos de
   llamadas por persona.
   *Solución:* que un robot de GitHub precalcule esos datos en un JSON (como
   ya se hace con `covers.json`) y quitar las llamadas en vivo. Mientras tanto,
   **no cargar `RAWG_API_KEY`** en cPanel. Esfuerzo: medio.

6. **La página se redibuja entera cuando llega el catálogo.** `render()`
   reconstruye toda la vista (incluido el banner) al terminar de bajar el
   catálogo: parpadeo visible y el banner "vuelve a cargar" a los ~15 s en
   celulares lentos.
   *Solución:* al llegar el catálogo, actualizar solo la grilla/contadores.
   Esfuerzo: medio.

7. **La base de datos depende de la cuenta de Vercel.** La organización de
   Supabase la creó la integración de Vercel (ícono ▲). Si se borra la cuenta
   o el equipo de Vercel, se puede perder.
   *Solución:* pasar el proyecto a una organización propia de Supabase. Hasta
   entonces: **no borrar la cuenta ni el equipo de Vercel** (bajar a Hobby sí).

8. **42 de 167 destacados muestran el precio escrito a mano.** Sus nombres en
   `featured-games.json` no coinciden con el de PSN (p. ej. "God of War
   (2018)", "Marvel's Spider-Man", "Hogwarts Legacy"), así que el robot no les
   encuentra precio en vivo (`featured-prices.json` → `unresolved`).
   *Solución:* ajustar esos nombres o agregarles `psnId`. Esfuerzo: bajo.

9. **El contador de visitas acepta cualquier cosa.** `/api/analytics` (POST)
   no tiene protección: alguien puede inflar las visitas o llenar la tabla
   `page_views`. *Solución:* límite por IP y descartar envíos sin `sid`
   válido. Esfuerzo: bajo.

### Baja

10. **Accesibilidad (detalles):** los puntos del carrusel del inicio son muy
    chicos para el dedo; el botón "Instalar app" tiene una etiqueta que no
    coincide con su texto visible; en el combo los títulos saltan de h1 a h3.
11. **Videos de banner (PS5 1,8 MB, PS4 0,6 MB)** en las páginas de
    plataforma: pesan más que el catálogo de Xbox. Versión más liviana o
    mostrarlos solo con Wi-Fi.
12. **Imágenes del banner** sin tamaños para celular: ~640 KB de ahorro
    posible sirviendo versiones más chicas.
13. **Cierre de Vercel (tareas del dueño):** bajar el plan Pro a Hobby antes
    de la renovación; más adelante borrar en Google Cloud el secreto viejo del
    cliente OAuth; activar la renovación automática del dominio
    (vence 23/08/2027, igual que el hosting).

## Lo que está bien

- **Celular:** las 20 páginas principales se ven bien a 360 px, sin
  desbordes, sin páginas vacías y sin errores de JavaScript.
- **SEO 92, accesibilidad 95–100** en Lighthouse.
- **Seguridad:** cookie de sesión `HttpOnly; Secure; SameSite=Lax`; cabeceras
  de seguridad (CSP, X-Frame-Options, nosniff…) servidas por `.htaccess`;
  compras, clientes y bundles protegidos con sesión de administrador;
  contraseñas de cuentas vendidas cifradas (AES-256-GCM) con la clave nueva,
  las 111 recuperadas; el webhook de Telegram valida su secreto; el servidor
  Node solo expone las rutas de `api/` (no `_lib.js`) y limita el tamaño del
  cuerpo a 1 MB; el archivo interno del FTP no es público.
- **Robots de GitHub sanos:** publicación a Banahosting 16/16 corridas bien;
  precios PS cada 3 h 33/34; catálogo PS 10/10; bundles 28/28; Xbox 9/10 (se
  recuperó solo).
- **Precios al día:** las ofertas se actualizan cada 3 h sin gastar servidor.
