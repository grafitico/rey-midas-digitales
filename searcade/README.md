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

Pendiente: probador con cámara (MediaPipe Pose).
