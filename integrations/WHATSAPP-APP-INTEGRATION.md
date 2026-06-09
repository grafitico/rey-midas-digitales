# 🔗 Integración: Conversión de Precios en WhatsApp App

Guía para integrar la API de conversión de precios en tu app de publicación de ofertas.

---

## 📋 Quick Start (30 segundos)

### 1. Copia el script a tu app

```html
<!-- En el <head> o antes de </body> -->
<script src="https://reymidascr.com/integrations/whatsapp-app-price-converter.js"></script>
```

### 2. Úsalo en tu código

```javascript
// Convertir un precio
const result = await priceConverter.convertPrice(19.99, "PS5");
console.log(result.principal);   // 9500
console.log(result.secundaria);  // 5800

// Formatear
console.log(priceConverter.formatCRC(9500)); // "₡9.500"
```

---

## 🎯 Casos de Uso

### Caso 1: Auto-convertir al escribir precio

```html
<input class="price-usd" data-platform="PS5" type="number" placeholder="Precio USD">
<div data-display="price-usd"></div>

<script>
  priceConverter.setupAutoConvert();
</script>
```

**Resultado**: Al escribir `19.99`, automáticamente muestra:
```
💳 ₡9.500 (principal) / ₡5.800 (secundaria)
```

---

### Caso 2: Inyectar vista previa en formulario

```html
<form id="offerForm">
  <input type="text" name="title" placeholder="Nombre del juego">
  <input type="number" name="priceUSD" placeholder="Precio USD">
  <select name="platform">
    <option value="PS5">PS5</option>
    <option value="Xbox">Xbox</option>
    <option value="Switch">Switch</option>
  </select>
  <!-- Vista previa se inyecta aquí automáticamente -->
</form>

<script>
  const form = document.getElementById("offerForm");
  priceConverter.injectPricePreview(form);
</script>
```

---

### Caso 3: Enriquecer datos antes de guardar

```javascript
async function guardarOferta(offerData) {
  // Enriquecer con precios convertidos
  const enriched = await priceConverter.enriquecerConPrecios(offerData);

  // Ahora tenemos:
  // - enriched.priceCRC_principal
  // - enriched.priceCRC_secundaria
  // - enriched.convertedAt

  // Guardar en BD
  await saveToDatabase(enriched);
}

// Uso
guardarOferta({
  title: "Elden Ring",
  priceUSD: 49.99,
  platform: "PS5",
});
```

---

### Caso 4: Convertir múltiples ofertas en lote

```javascript
const offers = [
  { title: "Game 1", priceUSD: 19.99, platform: "PS5" },
  { title: "Game 2", priceUSD: 29.99, platform: "Xbox" },
  { title: "Game 3", priceUSD: 39.99, platform: "Switch" },
];

const converted = await priceConverter.convertBatch(offers);
console.log(converted);
// [
//   { title: "Game 1", priceUSD: 19.99, priceCRC_principal: 9500, priceCRC_secundaria: 5800, ... },
//   { title: "Game 2", priceUSD: 29.99, priceCRC_principal: 14000, priceCRC_secundaria: 7000, ... },
//   { title: "Game 3", priceUSD: 39.99, priceCRC_principal: 21200, priceCRC_secundaria: 11115, ... },
// ]
```

---

## 🔧 API Completa

### `convertPrice(priceUSD, platform)`

Convierte un precio USD a CRC.

**Parámetros:**
- `priceUSD` (number): Precio en USD
- `platform` (string): "PS5" | "PS4" | "Xbox" | "Switch" (default: "PS5")

**Retorna:** `{principal, secundaria, exchangeRate, ...}`

```javascript
const result = await priceConverter.convertPrice(19.99, "PS5");
// {
//   priceUSD: 19.99,
//   platform: "PS5",
//   principal: 9500,
//   secundaria: 5800,
//   exchangeRate: 530,
//   ...
// }
```

---

### `convertPriceWithCache(priceUSD, platform)`

Como `convertPrice()` pero cachea resultados para evitar requests innecesarios.

```javascript
// Primera llamada: hace request HTTP
const result1 = await priceConverter.convertPriceWithCache(19.99, "PS5");

// Segunda llamada: devuelve del cache (instantáneo)
const result2 = await priceConverter.convertPriceWithCache(19.99, "PS5");
```

---

### `convertBatch(offers)`

Convierte múltiples ofertas. Útil para importar catálogos.

**Parámetros:**
- `offers` (Array): `[{priceUSD, platform}, ...]`

**Retorna:** Array con precios añadidos

---

### `formatCRC(amount)`

Formatea un número a CRC con estilo local.

```javascript
priceConverter.formatCRC(9500);   // "₡9.500"
priceConverter.formatCRC(15000);  // "₡15.000"
```

---

### `setupAutoConvert()`

Configura inputs con clase `.price-usd` para convertir automáticamente.

```html
<input class="price-usd" data-platform="PS5">
<input class="price-usd" data-platform="Xbox">

<script>
  priceConverter.setupAutoConvert();
</script>
```

---

### `injectPricePreview(formElement)`

Inyecta una vista previa de precios en un formulario.

```javascript
const form = document.getElementById("myForm");
priceConverter.injectPricePreview(form);
```

---

### `enriquecerConPrecios(offerData)`

Async. Añade `priceCRC_principal` y `priceCRC_secundaria` a un objeto.

```javascript
const offer = { title: "Game", priceUSD: 19.99, platform: "PS5" };
const enriched = await priceConverter.enriquecerConPrecios(offer);
// {
//   title: "Game",
//   priceUSD: 19.99,
//   platform: "PS5",
//   priceCRC_principal: 9500,
//   priceCRC_secundaria: 5800,
//   convertedAt: "2026-06-09T..."
// }
```

---

### `clearPriceCache()`

Limpia el cache local. Útil si cambias la configuración de precios.

```javascript
priceConverter.clearPriceCache();
```

---

## 🎨 Ejemplos Completos

### Ejemplo 1: Formulario de nueva oferta

```html
<form id="newOfferForm">
  <div>
    <label>Nombre</label>
    <input type="text" name="title" required>
  </div>

  <div>
    <label>Plataforma</label>
    <select name="platform">
      <option value="PS5">PS5</option>
      <option value="Xbox">Xbox</option>
      <option value="Switch">Switch</option>
    </select>
  </div>

  <div>
    <label>Precio USD</label>
    <input type="number" name="priceUSD" placeholder="19.99" step="0.01" required>
  </div>

  <button type="submit">Crear oferta</button>
</form>

<script>
  // Inyectar vista previa
  priceConverter.injectPricePreview(document.getElementById("newOfferForm"));

  // Manejar envío
  document.getElementById("newOfferForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const offer = Object.fromEntries(formData);

    // Enriquecer con precios
    const enriched = await priceConverter.enriquecerConPrecios(offer);

    // Enviar a API
    const res = await fetch("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    });

    if (res.ok) {
      alert("✅ Oferta creada");
      e.target.reset();
    }
  });
</script>
```

---

### Ejemplo 2: Tabla de ofertas con conversión automática

```html
<table>
  <thead>
    <tr>
      <th>Juego</th>
      <th>USD</th>
      <th>Principal CRC</th>
      <th>Secundaria CRC</th>
    </tr>
  </thead>
  <tbody id="offersTable">
  </tbody>
</table>

<script>
  async function cargarOfertas() {
    const offers = [
      { title: "Baldur's Gate 3", priceUSD: 49.99, platform: "PS5" },
      { title: "Elden Ring", priceUSD: 39.99, platform: "PS4" },
      { title: "Starfield", priceUSD: 59.99, platform: "Xbox" },
    ];

    const converted = await priceConverter.convertBatch(offers);

    const html = converted
      .map(
        (o) => `
      <tr>
        <td>${o.title}</td>
        <td>$${o.priceUSD}</td>
        <td>${priceConverter.formatCRC(o.priceCRC_principal)}</td>
        <td>${priceConverter.formatCRC(o.priceCRC_secundaria)}</td>
      </tr>
    `
      )
      .join("");

    document.getElementById("offersTable").innerHTML = html;
  }

  cargarOfertas();
</script>
```

---

## ⚙️ Configuración Avanzada

### Cambiar URL de API

Si despliegas el servidor en otro lugar:

```javascript
// Antes de usar el módulo
window.PRICE_CONVERTER_API = "https://tu-servidor.com/api/price-converter";
```

### Interceptar conversiones

Para loguear o validar:

```javascript
const originalConvert = priceConverter.convertPrice;

priceConverter.convertPrice = async function (usd, platform) {
  console.log(`Convirtiendo ${usd} USD para ${platform}`);
  const result = await originalConvert(usd, platform);
  console.log(`Resultado:`, result);
  return result;
};
```

### Event listeners

Escuchar cuando se convierte un precio:

```javascript
document.addEventListener("priceConverted", (e) => {
  console.log("Precio convertido:", e.detail);
});
```

---

## 🐛 Troubleshooting

### "convertPrice is not defined"

Asegúrate de incluir el script:

```html
<script src="https://reymidascr.com/integrations/whatsapp-app-price-converter.js"></script>
```

### "CORS error"

Si estás en localhost:

```javascript
// Asegúrate que el servidor está corriendo
// y permitiendo CORS
```

### Precios no se actualizan

Limpia el cache:

```javascript
priceConverter.clearPriceCache();
```

---

## 📞 Soporte

¿Problemas? Escribe a +506 6146-8733 (WhatsApp)

---

## 📚 Documentación relacionada

- `PRICE-CONVERTER-API.md` — API completa
- `QUICK-START-PRICING.md` — Guía rápida
- `scripts/PRICING-SCRIPTS-README.md` — Scripts Node.js

---

**¡Tu app está lista para convertir precios automáticamente! 🚀**
