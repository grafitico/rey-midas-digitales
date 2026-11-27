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
- Escenario (25/11/2026): tarima 3D en SVG dentro de `index.html` (`.tarima`:
  dos niveles, anillos que giran, LEDs, reflejo) y marco del perchero en SVG
  (`#marcoSvg`, el trazo lo ajusta `app.js` al tamaño para que las esquinas en
  diagonal cierren). Partículas y energía en el canvas `#energia`. Nada de eso
  usa imágenes ni filtros animados (rendimiento en teléfonos).

## Subcategorías, camisetas oscuras y acceso del asistente (26/11/2026)

- `sub` en `artes.json` (lista "Subcategoría" de cada arte en el panel): al
  tocar una categoría que tenga artes con subcategoría aparece una fila de
  botones (Anime → Todos · Attack on Titan · Dragon Ball Z).
- Panel → Categorías (acción `categorias`, se guarda en `artes.json` →
  `categorias`): crear, renombrar, ordenar y borrar categorías (solo sin
  artes), ícono de la galería `iconos.js` o un emoji, y subcategorías (crear,
  renombrar —sus artes las siguen—, ordenar y quitar). Sin esa lista, la tienda
  usa las de `productos.json`. Una categoría nueva aparece en la tienda cuando
  tiene al menos un diseño.
- `oscuras: true` ("Solo camisetas oscuras" en el panel): arte de recorte, la
  tela hace las sombras. La tienda solo ofrece `config.js` → `coloresOscuros`
  y, si el color elegido no va, lo muestra y lo vende en negra.
- `api/searcade.js` acepta también el token de Admin → 🤖 Asistente de Rey Midas
  en `Authorization: Bearer`, solo para `yo`, `listar`, `subir`, `editar`,
  `original` y `miniatura` (no borra ni descarga originales). Así Claude puede
  cargar artes con la misma protección que el panel (vista previa de 800 px con
  marca de agua, original ≤ 1400 px en la carpeta privada, miniatura).
- Mejor recibir los artes en ZIP/RAR: llegan en alta resolución y con fondo
  transparente.

## Carga masiva (26/11/2026)

- Panel → Carga masiva: elegir o arrastrar una carpeta (miles de PNG/WebP). Cada
  archivo se clasifica por el nombre de sus carpetas y el suyo: nombre o
  palabras clave 🔑 de una subcategoría → esa subcategoría; de una categoría →
  esa categoría; si no, a la categoría de "Los que no reconozca", y la carpeta
  más cercana (no genérica: PNG, artes, final…) pasa a ser subcategoría nueva.
  La carpeta elegida no cuenta si tiene subcarpetas. Nombre: el del archivo, o
  "<Subcategoría> <número>" si solo repite la colección.
- Al subir, cada imagen se mira: "solo camisetas oscuras" si casi no tiene negro
  (< 3 %: la tela hace las sombras) y semitono si 4 tintas o menos cubren el
  95 % (calibrado con 25 artes reales: 22/25 y 21/25). Se sube de a uno (vista,
  original y miniatura, con `corto: true`), con pausa y tiempo restante; la ruta
  del archivo queda en `fuente` y repetir la carpeta salta lo ya subido.
- Tope: 5000 artes (`MAX_ARTES`). La tienda solo dibuja las camisetas cercanas a
  la del centro (`VENTANA`) y "Arma tu espalda" muestra hasta 40, primero las de
  la misma subcategoría: con 2000 artes pasar de camiseta bajó de 8 s a < 0,3 s.
- Panel → Artes publicados: de a 30, con buscador y filtro por categoría.
- Carpeta del organizador de artes (Marca → Categoría, `SRC-ANI-0003_naruto.png`):
  las carpetas de marca (SEARCADE, Grafitico, Rey Midas, Tikicia) no cuentan
  como subcategoría; el código del inicio se quita del nombre, se guarda en
  `codigo` (buscable en el panel) y evita duplicados aunque cambie la carpeta.
  "Las carpetas que no reconozca son: categorías nuevas" crea en la tienda las
  categorías del organizador (Navidad, Motos…); la carpeta pesa más que una
  palabra suelta del nombre del archivo.
- Elegir qué subir: casilla por grupo (Categoría › Subcategoría) y por arte, y
  "Marcar todo / Desmarcar todo"; "Subir marcados" sube solo esos. El código
  del organizador se ve en la ficha de cada arte publicado ("Código: …").
- Buscador de Artes (BUSCADOR_DE_ARTES.html, en la carpeta principal de artes
  junto a `_CATALOGO/catalogo.js`): se marcan con ⭐ los diseños para la web y
  "Bajar JSON para la web" descarga `artes-para-web.json`
  (`{ artes: [{ codigo, titulo, categoria, fechaEspecial, tema, formatos,
  vistaPrevia, archivos }] }`, rutas relativas a la carpeta principal). En
  Carga masiva: "📄 JSON del Buscador de Artes" y después "📁 Elegir carpeta"
  (la principal): se busca el PNG/WebP de cada arte y se usan su código,
  título, categoría (nueva si no existe) y tema (subcategoría). Los que solo
  tienen vectores/PSD o cuyo PNG no está quedan con error y no se suben.
- Huella de imagen (`huella.js`, campo `huella` en `artes.json`): dHash de 64
  bits del dibujo recortado y sobre gris. Mismo arte = 0–5 bits distintos aunque
  tenga marca de agua u otro tamaño; artes distintos ≥ 14 (calibrado con los 25
  de Attack on Titan, originales contra miniaturas). Umbral 8. La carga masiva y
  la subida de a pocos no suben un dibujo que ya está (aunque tenga otro nombre o
  no tenga código) y la API lo vuelve a revisar (`forzar: true` lo permite). Los
  artes viejos reciben su huella solos al abrir el panel. Panel → Artes
  publicados → "🔍 Buscar repetidos": grupos del mismo dibujo, sugiere quedarse
  con el que tiene subcategoría y código, y borra las copias.
- `claras: true` ("Solo camisetas claras"): arte de líneas negras que en camiseta
  oscura no se ve; la tienda solo ofrece `config.js` → `coloresClaros` (blanca,
  gris). La carga masiva lo marca sola si más del 60 % del dibujo es negro.

## Tienda: buscar, cuadrícula y compra (auditoría 27/11/2026)

- Buscador arriba (nombre, subcategoría, categoría, código): busca en todo menos
  las categorías adultas. Vista Perchero / Cuadrícula (`#vistaTog`): sin elección
  del cliente, cuadrícula al buscar o con subcategoría, perchero si no; la
  elección se guarda en localStorage. La cuadrícula carga de a 36 ("Ver más") y
  tocar un diseño lo abre en el perchero con su ficha.
- Teléfono: categorías en dos filas que se deslizan, subcategorías y la barra de
  vista DEBAJO de las categorías (`ubicarFiltros`), encabezado compacto, la ficha
  después de "Arma tu espalda" (que va justo debajo del perchero) y una barra fija con nombre,
  precio y "Elegir talla" / "Agregar al carrito".
- `config.js` → `categoriasAdultas` (hentai): al final del menú, fuera de
  "Todas", de la búsqueda y de "Arma tu espalda", con aviso +18 (localStorage
  `searcade-18`).
- Enlace `#<id>`: abre el diseño dentro de su categoría y subcategoría.
