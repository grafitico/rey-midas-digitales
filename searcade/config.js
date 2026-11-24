// Configuración de SEARCADE. Es lo único que hay que tocar para datos de contacto.
window.SEARCADE_CONFIG = {
  // Número de WhatsApp de pedidos, con código de país y sin "+" ni espacios.
  // Ejemplo: "50688887777". Si queda vacío, WhatsApp abre para elegir contacto.
  whatsapp: "",
  // Moneda para mostrar precios.
  moneda: "₡",
  // Precio y tallas de una camiseta con un arte subido desde el panel
  // (cada arte puede tener su propio precio).
  precioBase: 11000,
  tallas: ["S", "M", "L", "XL", "XXL"],
  descripcionArte: "Estampado DTF a todo color sobre camiseta negra de algodón premium.",
  // Camiseta en blanco sobre la que se estampan los artes (PNG con fondo
  // transparente, de frente). Si el archivo no existe, se dibuja una.
  camisetaBase: "img/marca/camiseta-base.webp",
  // Zona del estampado sobre esa camiseta, en % del ancho y alto de la imagen.
  zona: { x: 31, y: 27, ancho: 38, alto: 48 },
  // API de Rey Midas (panel de artes).
  api: "https://reymidascr.com/api/searcade",
  // Fase 2: cuando exista el proyecto en Supabase, llenar esto y los productos
  // se leerán de la base en vez de productos.json.
  supabaseUrl: "",
  supabaseAnonKey: "",
};
