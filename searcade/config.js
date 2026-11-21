// Configuración de SEARCADE. Es lo único que hay que tocar para datos de contacto.
window.SEARCADE_CONFIG = {
  // Número de WhatsApp de pedidos, con código de país y sin "+" ni espacios.
  // Ejemplo: "50688887777". Si queda vacío, WhatsApp abre para elegir contacto.
  whatsapp: "",
  // Moneda para mostrar precios.
  moneda: "₡",
  // Fase 2: cuando exista el proyecto en Supabase, llenar esto y los productos
  // se leerán de la base en vez de productos.json.
  supabaseUrl: "",
  supabaseAnonKey: "",
};
