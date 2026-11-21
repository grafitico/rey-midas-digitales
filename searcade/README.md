# SEARCADE — searcade.reymidascr.com

Tienda estática (HTML/CSS/JS, sin compilación) de la marca SEARCADE de Grafitico.
Se publica sola en Banahosting con `.github/workflows/deploy-searcade.yml`
cuando cambia algo en esta carpeta (en `main`).

- `config.js`: número de WhatsApp de pedidos (y, en la fase 2, Supabase).
- `productos.json`: categorías y productos. Campos de cada producto:
  `id`, `nombre`, `categoria`, `precio`, `tallas`, `descripcion`,
  `imagen` (mockup PNG, ej. `img/productos/SC-001.png`), `fotos` (fotos con
  modelo), `nuevo`, `arte` (texto y color de la camiseta de muestra que se
  dibuja mientras no haya `imagen`).
- `img/productos/`: los PNG de mockups y fotos.

Enlace directo a una ficha: `https://searcade.reymidascr.com/#SC-001`.

Pendiente: Supabase + panel admin; probador con cámara (MediaPipe Pose).
