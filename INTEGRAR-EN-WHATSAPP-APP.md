# 🔗 Cómo Integrar en tu App de WhatsApp

Guía paso a paso para que tu app `https://whatsapp.reymidascr.com/` use la API de conversión automáticamente.

---

## 🎯 Lo que lograrás

✅ **Antes**: Escribes precio USD en tu app, tienes que calcular CRC manualmente  
✅ **Después**: Escribes precio USD, aparece automáticamente en CRC (principal y secundaria)

---

## 📝 PASO 1: Incluir el script en tu app

En tu archivo `index.html` (la app que compartiste), añade esto **antes del cierre de `</body>`**:

```html
<!-- API de conversión de precios -->
<script src="https://reymidascr.com/integrations/whatsapp-app-price-converter.js"></script>
```

---

## 🔧 PASO 2: Activar conversión automática (Opción A - Recomendado)

Si tienes un input donde escribes el precio USD:

```html
<!-- En tu formulario de crear oferta -->
<form id="createOfferForm">
  <input 
    type="number" 
    class="price-usd" 
    data-platform="PS5" 
    placeholder="Precio USD"
    id="priceInput"
  >
  
  <!-- La vista previa aparecerá aquí automáticamente -->
  <div data-display="priceInput"></div>
</form>

<script>
  // Al cargar la página, activar conversión automática
  document.addEventListener("DOMContentLoaded", () => {
    priceConverter.setupAutoConvert();
  });
</script>
```

**Resultado**: Al escribir `19.99`, aparecerá en tiempo real:
```
💳 ₡9.500 (principal) / ₡5.800 (secundaria)
```

---

## 🔧 PASO 3: Enriquecer datos antes de guardar (Opción B)

Cuando haces clic en "Crear Oferta", enriquece los datos automáticamente:

```javascript
async function crearOferta() {
  // Obtener datos del formulario
  const offerData = {
    title: document.querySelector("#gameTitle").value,
    priceUSD: Number(document.querySelector("#priceInput").value),
    platform: document.querySelector("#platform").value,
  };

  // ✨ ENRIQUECER CON PRECIOS CRC
  const enriched = await priceConverter.enriquecerConPrecios(offerData);

  // Ahora tenemos:
  // - enriched.priceCRC_principal (ej: 9500)
  // - enriched.priceCRC_secundaria (ej: 5800)

  // Guardar en tu BD o API
  await guardarEnBaseDatos(enriched);
}
```

---

## 📋 PASO 4: Convertir ofertas en lote (si importas catálogos)

Si importas múltiples juegos desde PSN/Xbox:

```javascript
async function importarCatalogo(juegos) {
  // juegos = [{priceUSD: 19.99, platform: "PS5"}, ...]

  const convertidos = await priceConverter.convertBatch(juegos);

  // Ahora cada juego tiene priceCRC_principal y priceCRC_secundaria
  // Guardar todos de una vez
  await guardarMultiples(convertidos);
}
```

---

## 💻 Ejemplo Completo (HTML + JS)

Copia y pega esto en tu app:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Nueva Oferta</title>
</head>
<body>
  <form id="offerForm">
    <h2>Crear Nueva Oferta</h2>

    <div>
      <label>Nombre del juego</label>
      <input type="text" id="title" required>
    </div>

    <div>
      <label>Plataforma</label>
      <select id="platform">
        <option value="PS5">PS5</option>
        <option value="Xbox">Xbox</option>
        <option value="Switch">Switch</option>
      </select>
    </div>

    <div>
      <label>Precio USD</label>
      <input type="number" class="price-usd" id="priceUSD" step="0.01" required>
      <div id="pricePreview"></div>
    </div>

    <button type="submit">Crear Oferta</button>
  </form>

  <!-- ✨ IMPORTANTE: Incluir el script -->
  <script src="https://reymidascr.com/integrations/whatsapp-app-price-converter.js"></script>

  <script>
    // Configurar conversión automática
    document.addEventListener("DOMContentLoaded", () => {
      // Opción 1: Auto-convert (para .price-usd)
      priceConverter.setupAutoConvert();

      // Opción 2: Vista previa personalizada
      document.querySelector("#priceUSD").addEventListener("input", async (e) => {
        const usd = Number(e.target.value);
        if (usd > 0) {
          const platform = document.querySelector("#platform").value;
          const result = await priceConverter.convertPrice(usd, platform);
          if (result) {
            document.querySelector("#pricePreview").innerHTML = `
              <p>
                💳 ${priceConverter.formatCRC(result.principal)} (principal)
                / 🎟️ ${priceConverter.formatCRC(result.secundaria)} (secundaria)
              </p>
            `;
          }
        }
      });
    });

    // Manejar envío del formulario
    document.getElementById("offerForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const offer = {
        title: document.querySelector("#title").value,
        platform: document.querySelector("#platform").value,
        priceUSD: Number(document.querySelector("#priceUSD").value),
      };

      // ✨ Enriquecer con precios CRC
      const enriched = await priceConverter.enriquecerConPrecios(offer);

      console.log("Oferta enriquecida:", enriched);
      // {
      //   title: "Baldur's Gate 3",
      //   platform: "PS5",
      //   priceUSD: 49.99,
      //   priceCRC_principal: 23500,
      //   priceCRC_secundaria: 13200,
      //   convertedAt: "2026-06-09T..."
      // }

      // Guardar en tu BD
      // await fetch("/api/offers", {
      //   method: "POST",
      //   body: JSON.stringify(enriched)
      // });

      alert("✅ Oferta creada: " + enriched.title);
      e.target.reset();
    });
  </script>
</body>
</html>
```

---

## 🎨 Casos de Uso en tu App

### Usar en tabla de ofertas

```javascript
async function mostrarOfertas() {
  const offers = [
    { title: "Elden Ring", priceUSD: 39.99, platform: "PS5" },
    { title: "Starfield", priceUSD: 59.99, platform: "Xbox" },
  ];

  // Convertir todas de una vez
  const converted = await priceConverter.convertBatch(offers);

  // Renderizar tabla
  const html = converted
    .map(
      (o) => `
    <tr>
      <td>${o.title}</td>
      <td>${o.platform}</td>
      <td>$${o.priceUSD}</td>
      <td>${priceConverter.formatCRC(o.priceCRC_principal)}</td>
      <td>${priceConverter.formatCRC(o.priceCRC_secundaria)}</td>
    </tr>
  `
    )
    .join("");

  document.getElementById("offersTable").innerHTML = html;
}
```

### Validar precio antes de guardar

```javascript
async function validarYGuardar(offerData) {
  // Convertir
  const converted = await priceConverter.enriquecerConPrecios(offerData);

  // Validar que no sea muy bajo
  if (converted.priceCRC_principal < 1000) {
    alert("❌ Precio muy bajo");
    return false;
  }

  // Guardar
  return await guardarEnBD(converted);
}
```

---

## 🔒 Seguridad

El módulo:
- ✅ No guarda datos sensibles
- ✅ No modifica tu formulario sin permiso
- ✅ Solo hace requests a `reymidascr.com/api/price-converter`
- ✅ Cachea localmente para evitar requests innecesarios

---

## 📞 Si algo no funciona

1. **Verifica la consola**: Abre DevTools (F12) → Console
   - Deberías ver: `✓ Módulo de conversión de precios cargado`

2. **Verifica que el script está cargado**:
   ```javascript
   console.log(window.priceConverter); // debe existir
   ```

3. **Prueba manual**:
   ```javascript
   priceConverter.convertPrice(19.99, "PS5").then(r => console.log(r));
   ```

4. **Contacta**: WhatsApp +506 6146-8733

---

## 📚 Documentación Completa

- **`WHATSAPP-APP-INTEGRATION.md`** — Guía detallada con todos los métodos
- **`PRICE-CONVERTER-API.md`** — Referencia de la API HTTP
- **`QUICK-START-PRICING.md`** — Resumen rápido

---

## ✨ Resultado Final

Tu app ahora:

1. ✅ Convierte precios automáticamente al escribirlos
2. ✅ Guarda los precios en CRC en tu BD
3. ✅ Muestra precios formateados en tablas
4. ✅ Sincroniza con `reymidascr.com` automáticamente
5. ✅ Cache inteligente para rendimiento

---

**¡Listo para publicar ofertas sin calcular precios manualmente! 🚀**

Cualquier pregunta → WhatsApp +506 6146-8733
