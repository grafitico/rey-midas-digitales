# SEARCADE — searcade.reymidascr.com

Tienda estática (HTML/CSS/JS, sin compilación) de la marca SEARCADE de Grafitico: diseños en DTF full color y semitono, y camisetas personalizadas.
Se publica sola en Banahosting con `.github/workflows/deploy-searcade.yml`
cuando cambia algo en esta carpeta (en `main`).

- `config.js`: número de WhatsApp de pedidos (y, en la fase 2, Supabase).
- `productos.json`: categorías (pop, urbana, gamer, anime, verano) y productos. Campos de cada producto:
  `id`, `nombre`, `categoria`, `precio`, `tallas`, `descripcion`,
  `material`, `imagen` (mockup PNG, ej. `img/productos/SC-001.png`), `fotos` (fotos con
  modelo), `nuevo`, `arte` (texto y color de la camiseta de muestra que se
  dibuja mientras no haya `imagen`).
- `img/productos/`: los PNG de mockups y fotos.

Enlace directo a una ficha: `https://searcade.reymidascr.com/#SC-001`.

## Panel de artes (`admin.html`)

`searcade.reymidascr.com/admin.html`, con la sesión de admin de reymidascr.com.
Se suben PNG/WebP (el navegador recorta el borde transparente, achica a 1400 px
y pasa a WebP de menos de 700 KB); la API `api/searcade.js` los guarda en
`~/searcade.reymidascr.com/artes/` con el índice `artes.json`. La tienda lee ese
índice y estampa cada arte sobre la camiseta base (`config.js`: `camisetaBase`
y `zona`). Con artes publicados, los productos de ejemplo dibujados se ocultan.
`searcade/artes/` está en `.gitignore`: esos archivos viven solo en el hosting
y el deploy por FTP no los toca.

## Personalizador

Con un arte, el cliente elige color de camiseta, colocación (pecho, espalda o
ambas), tamaño del estampado (pequeño 10×10, mediano 20×25, grande 28×35 cm),
y talla (niños 2–12 años, adultos XS–3XL). Todo se configura en `config.js`
(`colores`, `colocaciones`, `formatos` con su `extra` de precio, `tallas`).
Las camisetas base (frente/espalda, blanca/negra) y la etiqueta salen de
`scripts/searcade-camisetas-base.py`; los demás colores tiñen la blanca. Las
medidas en cm se pasan a % de la foto con `foto.cmAncho`/`cmAlto`.

Pendiente: probador con cámara (MediaPipe Pose).

## Caché de fotos

Las fotos de `img/` llevan una caché de 7 días. Al publicar,
`scripts/searcade-version.mjs` les agrega a las rutas de `config.js` y
`styles.css` un `?v=<huella del archivo>`. Así, si se reemplaza una foto con el
mismo nombre (por ejemplo, la espalda de la camiseta), el cambio se ve enseguida.

## Venta, medición y compartir (25/11/2026)

- `config.js`: `envio`, `pagos`, `envioCorto`, `guiaTallas`, `redes` y
  `analitica` (`metaPixel`, `ga4`). Lo que queda vacío no se muestra ni se carga.
  Con analítica, la tienda registra ViewContent, AddToCart, InitiateCheckout
  (botón de WhatsApp del carrito), Contact (personalizada) y Share.
- Miniaturas: el panel arma sola una miniatura WebP (≤ 480 px, ≤ 140 KB) de
  cada arte que no la tenga (acción `miniatura` de `api/searcade.js`, campo
  `mini` en `artes.json`). El perchero, las fichas y el carrito usan la
  miniatura; la vista de cerca usa el arte completo. Al proteger un arte se
  borra su miniatura y el panel arma otra.
- `/d/<id>` (`d.php`) es la página para compartir un diseño: vista previa con
  foto, nombre y precio para WhatsApp/Facebook, y redirige a `/#<id>`.
  `/sitemap.xml` (`sitemap.php`) lista la tienda y cada diseño. Banahosting
  sirve PHP en el subdominio.
- La pantalla "Presiona START" sigue sola a los 1,6 s, se ve una vez por
  semana y no aparece al llegar con un enlace a un diseño.
- `img/marca/og-searcade.jpg` (1200×630) es la vista previa de la tienda al
  compartirla.
- Lookbook ligado (25/11/2026): cada foto puede decir qué diseño sale en ella
  (`arte` en el lookbook de `artes.json`; acciones `subir-foto` con `arte` y
  `editar-foto`). La ficha de ese diseño muestra "📸 Verla puesta" (abre la
  vista de cerca con las fotos primero), el botón del Lookbook pasa a "Ver esta
  camiseta" y `/d/<id>` usa esa foto como vista previa al compartir. Al borrar
  un diseño, sus fotos quedan como banners.
- "Arma tu espalda" es POR camiseta (`sel.espaldas`): elegir una ficha cambia
  solo la camiseta seleccionada, y "Ver espalda" gira solo esa.
