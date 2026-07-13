# Auditoría completa — reymidascr.com (julio 2026)

Alcance: código completo del repositorio (SPA `index.html` + `app.js` + `style.css`, funciones serverless en `/api`, Edge middleware, workflows de GitHub Actions y `vercel.json`). No se pudo medir el sitio en producción desde este entorno (red restringida), pero los tamaños de transferencia se midieron con gzip real sobre los archivos del repo.

---

## 1. RENDIMIENTO

### 🔴 Crítico

**1.1 — `ps-catalog.json` (10.1 MB, ~1.34 MB comprimido) se descarga completo en CADA visita**
`app.js:497` lo baja en la carga inicial junto con otras 15 peticiones, antes de poder pintar nada. Además:
- `vercel.json` marca todos los `*.json` con `max-age=0, must-revalidate`: el navegador revalida siempre, y como el catálogo se regenera **a diario** (workflow `sync-ps-catalog`), el usuario re-descarga ~1.3 MB casi cada día.
- `JSON.parse` de 10 MB + merge de 16,700 juegos bloquea el hilo principal (fácilmente 500 ms–1.5 s en un móvil de gama media, que es el dispositivo típico del cliente en CR).
- En datos móviles, 1.3 MB solo de catálogo es un costo real para el usuario.

*Recomendación (por orden de impacto):*
1. **Reducir el payload**: emitir desde el workflow un catálogo "ligero" solo con los campos que usa el frontend (id, title, platform, priceUSD, discount, imageUrl…). Suele recortar 50–70 %.
2. **Dividir por plataforma** (`ps5-catalog.json` / `ps4-catalog.json`) y cargar solo lo que la vista necesita; el home no necesita 16,700 juegos, solo destacados y ofertas.
3. **Diferir la carga**: pintar el home con featured/ofertas primero y traer el catálogo completo después (o solo al entrar a /plataforma o al buscar).
4. Cachear en IndexedDB con un hash de versión para no re-parsear ni re-descargar si no cambió.

**1.2 — Render 100 % en cliente con `<main>` vacío**
El HTML llega sin contenido; el LCP depende de descargar y ejecutar `app.js` (63 KB gzip) + resolver 16 fetches. First Contentful Paint y LCP van a estar mal en Lighthouse casi con seguridad. El middleware Edge solo prerenderiza *metas* para bots, no contenido.
*Recomendación:* incluir en `index.html` un esqueleto del hero + skeleton cards (CSS puro), y considerar inyectar el bloque "featured" server-side a futuro.

### 🟡 Importante

**1.3 — `nintendo-bundles.json` de 2.85 MB (351 KB gzip)** — se carga lazy solo en la vista Switch (bien), pero sigue siendo enorme para lo que muestra. Mismo tratamiento que 1.1: recortar campos.

**1.4 — Bundle JS monolítico** — `app.js` incluye tienda + carrito + panel admin + CRM de clientes en un solo archivo que descargan todos los visitantes. Separar `/admin` a su propio archivo recortaría bastante.

**1.5 — Medios del hero**
- `ps5-banner.mp4` 1.8 MB con `autoplay` — compite con el catálogo por ancho de banda justo al cargar. Considerar `preload="none"` + poster, o comprimirlo (AV1/H.265, o WebM) a <800 KB.
- Banners webp de 200–276 KB sin `srcset` — un móvil de 390 px descarga la imagen completa. Generar 2–3 tamaños.
- No hay `<link rel="preload">` para la imagen LCP del hero.
- `logo.png` (37 KB) se usa como favicon — un favicon de 37 KB se descarga en cada pestaña; un `.ico`/png de 32×32 pesa ~1–2 KB.

**1.6 — `style.css` (108 KB / 19 KB gzip) render-blocking** — aceptable, pero contiene estilos de admin/checkout que el primer paint no necesita. Critical CSS inline + resto diferido mejoraría FCP.

### ✅ Lo que ya está bien
- `Cache-Control: immutable` + versionado por query (`?v=`) para JS/CSS.
- Build con terser en deploy.
- `Promise.allSettled` con fallbacks: el sitio degrada bien si un JSON falla.
- Prerender Edge para bots (excelente idea, no consume funciones serverless).
- `s-maxage` + `stale-while-revalidate` en `/api/scrape`, `/api/featured-prices`, `/api/cover`.
- `preconnect` a YouTube, lazy-loading en imágenes de tarjetas, paginación a 50/página.

---

## 2. SEGURIDAD

### Base sólida (destacable para el stack)
- CSP estricta (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Sesión en cookie `HttpOnly; Secure; SameSite=Lax` firmada con HMAC-SHA256 — XSS no puede robar la sesión.
- Contraseñas con scrypt + salt + `timingSafeEqual`.
- `escapeHtml` usado consistentemente (~115 usos) en el render.
- Webhook de Telegram valida `x-telegram-bot-api-secret-token`; bootstrap de admin solo funciona con la tabla vacía.
- La service key de Supabase nunca sale del servidor; el cliente no usa supabase-js ni anon key.

### 🔴 Alto

**2.1 — Credenciales de cuentas de juego en texto plano en la base**
`purchases.account_password` y `verifier_codes` se guardan tal cual (api/purchases.js:51-52). El negocio necesita recuperarlas (no se pueden hashear), pero hoy un acceso a Supabase (fuga de service key, backup, dashboard) expone las credenciales de TODAS las cuentas vendidas.
*Recomendación:* cifrado a nivel de aplicación — AES-256-GCM con una clave en env de Vercel (`crypto` nativo, ~20 líneas). La base pasa a contener solo ciphertext. Verificar además que las tablas tengan RLS activado en Supabase como segunda capa.

### 🟡 Medio

**2.2 — Sin rate limiting en `/api/auth` (login)** — fuerza bruta ilimitada contra cuentas de clientes, agravado por mínimo de contraseña de 6 caracteres. *Recomendación:* límite por IP+email (Upstash Redis o un contador en Supabase) y subir el mínimo a 8.

**2.3 — Newsletter y analytics sin límites**
- `/api/newsletter subscribe`: cualquiera puede insertar emails en masa (spam a la tabla y generación masiva de códigos de 10 % OFF). Los códigos son además predecibles en parte (`BIENVENIDA-` + 4 letras del email + 4 aleatorias).
- `/api/analytics` POST acepta cualquier cosa sin validación → se pueden inflar las métricas o llenar la tabla `page_views`.
*Recomendación:* rate limit ligero y, para el descuento, validar el código server-side al canjearlo (hoy el canje es por WhatsApp, así que el riesgo real es acotado — pero documentarlo).

**2.4 — Inyección de filtros PostgREST en parámetros sin encodear**
`purchases?id=eq.${id}` (delete/update), `app_users?id=eq.${id}` (clients.js update/resetPassword): `id` viene del body sin `encodeURIComponent`, con lo que se pueden inyectar operadores extra de PostgREST (p. ej. `0&id=neq.0` borra/parcha filas arbitrarias). Requiere sesión admin, así que el riesgo práctico es bajo, pero el fix es una línea: `encodeURIComponent(id)` en cada interpolación (en emails ya se hace bien).

**2.5 — `/api/cover` es un proxy abierto con `Access-Control-Allow-Origin: *`**
Cualquier sitio de terceros puede usar tus funciones serverless (hasta 25 s de ejecución) para scrapear PSN/Xbox/YouTube a tu costo, con caché de CDN incluida. Además `?psnDebug=` es un endpoint de diagnóstico expuesto en producción.
*Recomendación:* quitar el CORS `*` (no hace falta: el frontend es same-origin), validar `Origin`/`Referer`, y eliminar o proteger `psnDebug`.

### 🟢 Bajo
- **AUTH_SECRET derivado del service key** si no está seteado (api/_lib.js:12-14): rotar la service key invalida todas las sesiones y acopla dos secretos. Setear `AUTH_SECRET` propio en Vercel.
- **Sesiones no revocables**: token HMAC stateless de 30 días; el logout solo borra la cookie y cambiar la contraseña no invalida sesiones ya emitidas. Añadir un `token_version` por usuario si esto importa.
- **CSRF**: mitigado por `SameSite=Lax` + JSON POST; añadir verificación del header `Origin` en los endpoints mutantes costaría poco.
- **GITHUB_TOKEN del webhook**: usar un fine-grained PAT limitado a este repo con solo `contents: write` (si no lo es ya).

---

## 3. MARKETING / SEO

### ✅ Lo que ya está bien
- Prerender Edge para crawlers con title/description/canonical por ruta y JSON-LD (`Product` con precio en CRC, `FAQPage`, `Organization`) — esto es más de lo que hace la mayoría de tiendas pequeñas.
- `sitemap.xml` generado por script + `robots.txt` correcto (bloquea /admin y /mi-cuenta).
- Embudo de captación: popup de 10 % OFF + newsletter en footer + botón flotante de WhatsApp + feed de "prueba social" con datos reales (no compras falsas — honesto y legalmente sano).
- OG/Twitter cards completos, `og:locale es_CR`.

### 🔴 Alto

**3.1 — No hay medición de conversión, y la conversión clave es el click a WhatsApp**
Todo el negocio convierte vía `wa.me`, y hoy no se registra ni un solo click. Solo existe un contador propio de page views (total/hoy/online). No sabés qué juego, qué banner ni qué página genera contactos.
*Recomendación mínima (sin tocar la CSP):* extender `/api/analytics` con un evento `wa_click` (+ producto + ruta) disparado en cada click a WhatsApp/carrito. Eso ya da tasa de conversión por página/producto con infraestructura que ya tenés.
*Si se quiere GA4/Meta Pixel:* la CSP actual (`script-src 'self'; connect-src 'self'`) los bloquea — habría que ampliarla deliberadamente. Para retargeting en Instagram/TikTok (donde está tu audiencia) el píxel de Meta puede justificar el trade-off; si no, el analytics propio es suficiente y más privado.

**3.2 — `og:image` relativa y genérica en `index.html`**
`content="/assets/logo.png?v=2"` — las URLs relativas son inválidas según la spec de Open Graph. El middleware la corrige para los bots de la lista `BOT_RE`, pero cualquier scraper fuera de esa lista recibe la relativa y no muestra imagen. Fix: URL absoluta en el HTML base. Además, la imagen es el logo genérico: una imagen 1200×630 diseñada (logo + "PS5·PS4·Xbox·Switch" + "Entrega inmediata · SINPE") mejora el CTR en cada share de WhatsApp, que es tu canal principal.

### 🟡 Medio

**3.3 — Riesgo de indexación por dependencia total de JS**
Googlebot recibe el prerender con metas correctas, pero el `<body>` sigue vacío: para ver el contenido debe ejecutar `app.js` y esperar los 16 fetches incluyendo los 1.3 MB del catálogo. El renderer de Google tiene presupuesto limitado y puede indexar páginas a medio cargar. Arreglar 1.1/1.2 también es un fix de SEO. Idealmente, el middleware podría inyectar HTML real (lista de productos) para bots, no solo metas.

**3.4 — Soft-404**: el rewrite de Vercel sirve el SPA con status 200 para cualquier URL inexistente (`/loquesea` → 200). Google lo trata como soft-404 y desperdicia crawl budget. El middleware podría devolver 404 para rutas que no matchean ningún producto/página conocida.

**3.5 — Reseñas sin marcado estructurado**: tenés `reviewStats` (4.9★, 247 reseñas) y testimonios reales, pero el JSON-LD de `Product` no incluye `aggregateRating`. Con rating en los productos, los resultados de Google muestran estrellas → CTR notablemente mayor. (En `Organization` Google ignora ratings self-serving; en `Product` sí los muestra.)

**3.6 — Lista de newsletter sin explotación visible**: se capturan emails con el 10 % OFF pero no hay nada en el repo que los use (campañas, avisos de ofertas). Aunque sea manual (exportar y mandar un mailing mensual de ofertas), esa lista es el activo de remarketing más barato que tenés.

### 🟢 Ideas rápidas
- Título del home: "Rey Midas Digitales — Juegos PS5 / PS4 / Xbox / Switch en Costa Rica" está bien; probá añadir el diferenciador en la meta description ("desde ₡2 500", "entrega en 10 min").
- Páginas de categoría/género (`/categoria/...` ya existe como ruta) no están en el sitemap — añadir las 10–15 categorías top.
- WhatsApp Business con catálogo + Google Business Profile (fuera del código, pero es el mayor palancazo local en CR).

---

## 4. Plan de acción priorizado

| # | Acción | Área | Esfuerzo | Impacto |
|---|--------|------|----------|---------|
| 1 | Catálogo PS ligero + dividido + carga diferida | Rendimiento/SEO | Medio | Muy alto |
| 2 | Evento `wa_click` en analytics propio | Marketing | Bajo | Alto |
| 3 | Cifrar `account_password`/`verifier_codes` (AES-GCM) | Seguridad | Bajo | Alto |
| 4 | Rate limit en login + newsletter; contraseñas mín. 8 | Seguridad | Bajo | Medio |
| 5 | `og:image` absoluta + imagen social 1200×630 | Marketing | Bajo | Medio |
| 6 | Quitar CORS `*` y `psnDebug` de `/api/cover` | Seguridad | Bajo | Medio |
| 7 | `encodeURIComponent` en filtros PostgREST con `id` | Seguridad | Trivial | Bajo |
| 8 | `aggregateRating` en JSON-LD de productos | Marketing | Bajo | Medio |
| 9 | Skeleton/hero estático en `index.html` | Rendimiento | Medio | Medio |
| 10 | 404 real para rutas inexistentes (middleware) | SEO | Bajo | Bajo |
