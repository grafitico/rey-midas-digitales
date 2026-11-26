// Configuración de SEARCADE. Es lo único que hay que tocar para datos de contacto.
window.SEARCADE_CONFIG = {
  // Número de WhatsApp de pedidos, con código de país y sin "+" ni espacios.
  // Ejemplo: "50688887777". Si queda vacío, WhatsApp abre para elegir contacto.
  whatsapp: "50661133381",
  // Moneda para mostrar precios.
  moneda: "₡",
  // ===== Compra, envío y confianza (lo que quede vacío no se muestra) =====
  // Debajo de "Compra ahora". Ej.: "Correos de Costa Rica · ₡2.500 · 2 a 4 días hábiles"
  envio: "",
  // Ej.: "SINPE Móvil o transferencia"
  pagos: "",
  // Texto corto de la franja de confianza (reemplaza "ENVÍO RÁPIDO"). Ej.: "ENVÍO 2–4 DÍAS"
  envioCorto: "",
  // Guía de tallas en cm (ancho de pecho × largo). Con datos, aparece el enlace
  // "Guía de tallas" junto a TALLA. Ej.: { "Adultos": { S: [46, 70], M: [50, 72] } }
  guiaTallas: {},
  // Redes de SEARCADE (enlaces completos). Aparecen en el pie de página.
  redes: { instagram: "", tiktok: "", facebook: "" },
  // Música de fondo (MP3 en la carpeta audio/). Vacío = sin música ni botón.
  // Suena desde el primer toque del visitante; el botón 🔊/🔇 la silencia y la
  // tienda recuerda la elección.
  musica: "",
  musicaVolumen: 0.35,
  // Medición de visitas y ventas (vacío = no se carga nada).
  // metaPixel: el número del píxel de Meta. ga4: el ID "G-XXXXXXX" de Google Analytics.
  analitica: { metaPixel: "", ga4: "" },
  // ===== Personalizador (camisetas con los artes subidos desde el panel) =====
  // Precio de la camiseta con un arte (cada arte puede tener su propio precio).
  precioBase: 11000,
  descripcionArte: "Estampado DTF a todo color sobre camiseta de algodón premium.",
  tallas: {
    "Niños (años)": ["2", "4", "6", "8", "10", "12"],
    "Adultos": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  },
  // Formatos comerciales de estampado (medidas reales del DTF) y lo que suman al precio.
  formatos: [
    { id: "pequeno", nombre: "Pequeño", ancho: 20, alto: 25, extra: 0, nota: "Estampado compacto" },
    { id: "mediano", nombre: "Mediano", ancho: 28, alto: 35, extra: 0, nota: "Estampado completo" },
    { id: "grande", nombre: "Grande", ancho: 34, alto: 42, extra: 0, nota: "Estampado máximo" },
  ],
  colocaciones: [
    { id: "pecho", nombre: "Pecho", extra: 0 },
    { id: "espalda", nombre: "Espalda", extra: 0 },
    { id: "ambas", nombre: "Pecho y espalda", extra: 3500 },
  ],
  formatoInicial: "mediano",
  // Textos de cada arte cuando el panel los deja vacíos: cambian según la
  // categoría y el arte (se elige uno fijo por arte, no al azar en cada visita).
  textosAuto: {
    coleccion: { pop: "POP CULTURE", urbana: "STREET LEVEL", gamer: "PLAYER ONE", anime: "OTAKU MODE", verano: "SUMMER DROP", otra: "SEARCADE DROP" },
    lemas: {
      pop: ["Brilla en cualquier pantalla", "Ícono de colección", "Pura actitud pop"],
      urbana: ["La calle es tu nivel", "Estilo sin pausa", "Hecho para la ciudad"],
      gamer: ["Una partida más", "Modo leyenda activado", "Press start a tu estilo"],
      anime: ["Tu estilo, modo protagonista", "Poder desbloqueado", "Episodio final: tú"],
      verano: ["Sol, playa y nivel máximo", "Modo vacaciones", "Calor de jefe final"],
      otra: ["Sube de nivel", "Edición SEARCADE", "Original o nada"],
    },
    descripciones: {
      pop: ["Arte de alto detalle con colores que se roban las miradas.", "Diseño pop impreso en DTF, listo para destacar."],
      urbana: ["Diseño urbano en DTF sobre algodón premium: para la calle, sin miedo.", "Actitud de barrio con acabado de primera."],
      gamer: ["Para los que no sueltan el control. Impresión DTF de alta definición.", "Diseño gamer con detalle de pantalla 4K."],
      anime: ["Ilustración de alto detalle con el estilo que te define.", "Tu personaje favorito en DTF de colores intensos."],
      verano: ["Colores que aguantan el sol y el mar.", "Fresco, liviano y con un arte que se ve de lejos."],
      otra: ["Camiseta premium con arte de alto detalle."],
    },
  },
  // Colores de camiseta. Negra y blanca usan su foto; los demás tiñen la blanca.
  colores: [
    { id: "negra", nombre: "Negra", hex: "#141218", frente: "img/marca/camiseta-negra.webp", espalda: "img/marca/camiseta-negra-espalda.webp" },
    { id: "blanca", nombre: "Blanca", hex: "#f1f1f4", frente: "img/marca/camiseta-blanca.webp", espalda: "img/marca/camiseta-blanca-espalda.webp" },
    { id: "gris", nombre: "Gris", hex: "#8e9097" },
    { id: "azul", nombre: "Azul marino", hex: "#1f2b4d" },
    { id: "roja", nombre: "Roja", hex: "#b3192e" },
    { id: "morada", nombre: "Morada", hex: "#5b2c86" },
    { id: "verde", nombre: "Verde militar", hex: "#4b5634" },
  ],
  // Colores donde se ofrecen los artes marcados "Solo camisetas oscuras"
  coloresOscuros: ["negra", "azul", "morada", "verde"],
  // Medidas de la foto base (salen de scripts/searcade-camisetas-base.py):
  // cuánto % de la imagen ocupa 1 cm, y dónde empieza cada estampado (en %).
  foto: {
    cmAncho: 1.2586, cmAlto: 1.2316,
    pecho: { top: 23.5 },                  // ~8 cm bajo el cuello, centrado
    pechoIzquierdo: { centro: 61.3, top: 21.5 },
    espalda: { top: 16.1 },                // ~8 cm bajo el cuello de atrás (foto real de espalda)
    espaldaArriba: { top: 9 },
    etiqueta: { src: "img/marca/etiqueta.webp", x: 46.77, y: 6.33, ancho: 7.03, alto: 4.56 },
  },
  // Vista previa en el panel de artes (estampado grande en el pecho).
  camisetaBase: "img/marca/camiseta-negra.webp",
  zona: { x: 32.4, y: 23.5, ancho: 35.2, alto: 43.1 },
  // Fotos fijas del Lookbook (las que se suben desde el panel salen antes).
  lookbook: [
    { archivo: "img/lookbook/otro-ano.webp", titulo: "Otro año ya se ha ido" },
    { archivo: "img/lookbook/llega-navidad.webp", titulo: "Llega Navidad" },
    { archivo: "img/lookbook/do-not-disturb.webp", titulo: "Do Not Disturb, I'm Gaming" },
  ],
  // API de Rey Midas (panel de artes).
  api: "https://reymidascr.com/api/searcade",
  // Fase 2: cuando exista el proyecto en Supabase, llenar esto y los productos
  // se leerán de la base en vez de productos.json.
  supabaseUrl: "",
  supabaseAnonKey: "",
};
