// Configuración de SEARCADE. Es lo único que hay que tocar para datos de contacto.
window.SEARCADE_CONFIG = {
  // Número de WhatsApp de pedidos, con código de país y sin "+" ni espacios.
  // Ejemplo: "50688887777". Si queda vacío, WhatsApp abre para elegir contacto.
  whatsapp: "50661133381",
  // Moneda para mostrar precios.
  moneda: "₡",
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
    { id: "pequeno", nombre: "Pequeño", ancho: 10, alto: 10, extra: 0, nota: "Logos · pecho izquierdo" },
    { id: "mediano", nombre: "Mediano", ancho: 20, alto: 25, extra: 0, nota: "Estampado compacto" },
    { id: "grande", nombre: "Grande", ancho: 28, alto: 35, extra: 0, nota: "Estampado completo" },
  ],
  colocaciones: [
    { id: "pecho", nombre: "Pecho", extra: 0 },
    { id: "espalda", nombre: "Espalda", extra: 0 },
    { id: "ambas", nombre: "Pecho y espalda", extra: 0 },
  ],
  formatoInicial: "grande",
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
  // Medidas de la foto base (salen de scripts/searcade-camisetas-base.py):
  // cuánto % de la imagen ocupa 1 cm, y dónde empieza cada estampado (en %).
  foto: {
    cmAncho: 1.2586, cmAlto: 1.2316,
    pecho: { top: 23.5 },                  // ~8 cm bajo el cuello, centrado
    pechoIzquierdo: { centro: 61.3, top: 21.5 },
    espalda: { top: 15 },                  // ~8 cm bajo el cuello de atrás
    espaldaArriba: { top: 9 },
    etiqueta: { src: "img/marca/etiqueta.webp", x: 46.77, y: 6.33, ancho: 7.03, alto: 4.56 },
  },
  // Vista previa en el panel de artes (estampado grande en el pecho).
  camisetaBase: "img/marca/camiseta-negra.webp",
  zona: { x: 32.4, y: 23.5, ancho: 35.2, alto: 43.1 },
  // API de Rey Midas (panel de artes).
  api: "https://reymidascr.com/api/searcade",
  // Fase 2: cuando exista el proyecto en Supabase, llenar esto y los productos
  // se leerán de la base en vez de productos.json.
  supabaseUrl: "",
  supabaseAnonKey: "",
};
