/**
 * INTEGRACIÓN: Conversión de precios para https://whatsapp.reymidascr.com/
 *
 * Este módulo se integra con la app de publicación de ofertas y convierte
 * automáticamente precios USD → CRC usando la API centralizada.
 *
 * Instalación:
 * 1. Copia este archivo a tu app
 * 2. Importa antes de tu código de ofertas: <script src="price-converter.js"></script>
 * 3. Llama a convertPrice() o setupAutoConvert() según necesites
 */

const PRICE_CONVERTER_API = "https://reymidascr.com/api/price-converter";

/**
 * Convierte un precio USD a CRC (HTTP request)
 * @param {number} priceUSD - Precio en USD
 * @param {string} platform - Plataforma: "PS5", "Xbox", "Switch" (default: "PS5")
 * @returns {Promise<{principal: number, secundaria: number}>}
 */
async function convertPrice(priceUSD, platform = "PS5") {
  try {
    const response = await fetch(PRICE_CONVERTER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceUSD: Number(priceUSD), platform }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Error en conversión:", error);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error("Error conectando a API de precios:", err);
    return null;
  }
}

/**
 * Formatea precio en CRC con estilo local
 * @param {number} amount - Cantidad en CRC
 * @returns {string} Precio formateado (ej: "₡9.500")
 */
function formatCRC(amount) {
  if (!amount || amount === 0) return "₡0";
  return (
    "₡" +
    Math.round(amount).toLocaleString("es-CR", {
      minimumFractionDigits: 0,
    })
  );
}

/**
 * Convierte y muestra precio automáticamente en un campo
 * Uso: <input class="price-usd" data-platform="PS5">
 * Automáticamente calcula y muestra en data-principal y data-secundaria
 */
function setupAutoConvert() {
  document.querySelectorAll(".price-usd").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const usd = Number(e.target.value);
      const platform = e.target.dataset.platform || "PS5";

      if (usd <= 0) {
        e.target.dataset.principal = "";
        e.target.dataset.secundaria = "";
        return;
      }

      const result = await convertPrice(usd, platform);
      if (result) {
        e.target.dataset.principal = result.principal;
        e.target.dataset.secundaria = result.secundaria;

        // Disparar evento personalizado para que otros escuchen
        e.target.dispatchEvent(
          new CustomEvent("priceConverted", {
            detail: { principal: result.principal, secundaria: result.secundaria },
          })
        );

        // Opcional: mostrar en pantalla
        const displayEl = document.querySelector(
          `[data-display="${e.target.id}"]`
        );
        if (displayEl) {
          displayEl.innerHTML = `
            <small style="color: #00ff41; font-size: 10px;">
              💳 ${formatCRC(result.principal)} (principal) / ${formatCRC(result.secundaria)} (secundaria)
            </small>
          `;
        }
      }
    });
  });
}

/**
 * Convierte múltiples precios en lote
 * @param {Array} offers - Array de ofertas [{priceUSD, platform}, ...]
 * @returns {Promise<Array>} Ofertas con precios convertidos
 */
async function convertBatch(offers) {
  const results = [];

  for (const offer of offers) {
    const converted = await convertPrice(
      offer.priceUSD,
      offer.platform || "PS5"
    );
    results.push({
      ...offer,
      priceCRC_principal: converted?.principal || 0,
      priceCRC_secundaria: converted?.secundaria || 0,
    });

    // Pequeño delay para no sobrecargar
    await new Promise((r) => setTimeout(r, 100));
  }

  return results;
}

/**
 * Hook para interceptar antes de guardar una oferta
 * Uso: window.hookBeforeSaveOffer = enriquecerConPrecios;
 */
async function enriquecerConPrecios(offerData) {
  if (!offerData.priceUSD) return offerData;

  const converted = await convertPrice(
    offerData.priceUSD,
    offerData.platform || "PS5"
  );

  return {
    ...offerData,
    priceCRC_principal: converted?.principal || 0,
    priceCRC_secundaria: converted?.secundaria || 0,
    convertedAt: new Date().toISOString(),
  };
}

/**
 * Inyecta un campo de vista previa de precios en un formulario
 * @param {HTMLElement} formElement - El formulario donde inyectar
 */
function injectPricePreview(formElement) {
  const priceInput = formElement.querySelector(
    'input[name="priceUSD"], .price-usd'
  );
  const platformSelect = formElement.querySelector(
    'select[name="platform"], .platform-select'
  );

  if (!priceInput) return;

  // Crear elemento de vista previa
  const preview = document.createElement("div");
  preview.className = "price-preview";
  preview.style.cssText = `
    margin-top: 10px;
    padding: 12px;
    background: rgba(0, 255, 65, 0.05);
    border: 1px solid #00ff41;
    border-radius: 6px;
    font-size: 11px;
    color: #00ff41;
    display: none;
  `;

  priceInput.parentElement.insertAdjacentElement("afterend", preview);

  // Actualizar vista previa
  const updatePreview = async () => {
    const usd = Number(priceInput.value);
    const platform = platformSelect ? platformSelect.value : "PS5";

    if (usd <= 0) {
      preview.style.display = "none";
      return;
    }

    const result = await convertPrice(usd, platform);
    if (result) {
      preview.style.display = "block";
      preview.innerHTML = `
        <strong>💰 Precios en CRC:</strong><br>
        💳 Principal: <strong>${formatCRC(result.principal)}</strong><br>
        🎟️  Secundaria: <strong>${formatCRC(result.secundaria)}</strong>
      `;
    }
  };

  priceInput.addEventListener("input", updatePreview);
  if (platformSelect) platformSelect.addEventListener("change", updatePreview);
}

/**
 * Cache local para no hacer requests innecesarios
 */
const priceCache = new Map();

async function convertPriceWithCache(priceUSD, platform = "PS5") {
  const key = `${priceUSD}_${platform}`;

  if (priceCache.has(key)) {
    return priceCache.get(key);
  }

  const result = await convertPrice(priceUSD, platform);
  if (result) {
    priceCache.set(key, result);
  }

  return result;
}

/**
 * Limpia el cache (útil después de actualizar configuración)
 */
function clearPriceCache() {
  priceCache.clear();
  console.log("✓ Cache de precios limpiado");
}

// Exportar funciones (si usas ES6 modules)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    convertPrice,
    convertPriceWithCache,
    convertBatch,
    formatCRC,
    setupAutoConvert,
    enriquecerConPrecios,
    injectPricePreview,
    clearPriceCache,
  };
}

// También exponemos globalmente
window.priceConverter = {
  convertPrice: convertPrice,
  convertPriceWithCache: convertPriceWithCache,
  convertBatch: convertBatch,
  formatCRC: formatCRC,
  setupAutoConvert: setupAutoConvert,
  enriquecerConPrecios: enriquecerConPrecios,
  injectPricePreview: injectPricePreview,
  clearPriceCache: clearPriceCache,
};

console.log("✓ Módulo de conversión de precios cargado");
console.log("   Usa: priceConverter.convertPrice(19.99, 'PS5')");
