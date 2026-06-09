# Scripts de Conversión de Precios 💰

Ejemplos listos para usar para publicar ofertas y convertir precios automáticamente.

## 📋 Scripts disponibles

### 1. `convert-prices-example.js`
**Objetivo**: Convertir precios USD → CRC usando la API HTTP

```bash
node scripts/convert-prices-example.js
```

Muestra:
- ✅ Cómo hacer requests a `/api/price-converter`
- ✅ Tabla de 6 juegos de ejemplo
- ✅ Precios en ambas modalidades (principal y secundaria)
- ✅ Manejo de errores

**Ideal para**: Apps externas que quieren integrar la API de reymidascr.com

---

### 2. `batch-convert-offers.mjs`
**Objetivo**: Convertir múltiples ofertas en lote (con archivo de salida)

```bash
node scripts/batch-convert-offers.mjs
```

**Entrada**: JSON con ofertas (o CSV convertido a JSON)
```json
[
  { "id": 1, "title": "Game", "priceUSD": 19.99, "platform": "PS5" }
]
```

**Salida**:
- 📊 Tabla con precios convertidos
- 📋 JSON enriquecido con `priceCRC_principal` y `priceCRC_secundaria`
- 📄 Archivo `offers-converted.json` listo para importar

Muestra:
- ✅ Conversión directa (sin HTTP, más rápido)
- ✅ Tabla formateada para lectura
- ✅ Guardar resultado a archivo

**Ideal para**: Importar catálogos completos desde Excel, CSV o APIs

---

### 3. `publish-offers-example.mjs`
**Objetivo**: Flujo completo de publicación de ofertas

```bash
node scripts/publish-offers-example.mjs
```

Flujo:
1. Define juegos con precios USD
2. Convierte a CRC automáticamente
3. Calcula descuentos
4. Simula publicación a BD

Muestra:
- ✅ Cómo estructurar datos de oferta
- ✅ Cálculo de descuentos
- ✅ Comparación de precios original vs actual
- ✅ Estructura para integración con BD

**Ideal para**: Entender el flujo antes de implementar tu propio sistema

---

## 🚀 Uso en tu propia app

### Node.js / JavaScript

#### Opción A: HTTP Request (desde cualquier lado)

```javascript
async function convertPrice(usd, platform) {
  const res = await fetch("https://reymidascr.com/api/price-converter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceUSD: usd, platform }),
  });
  return res.json();
}

// Uso
const result = await convertPrice(19.99, "PS5");
console.log(`Principal: ${result.principal} CRC`);
```

#### Opción B: Módulo directo (desde Node.js del servidor)

```javascript
import { principalCRC, secundariaCRC } from './api/pricing-utils.mjs';

const principal = principalCRC(19.99, "PS5");  // 9500
const secundaria = secundariaCRC(19.99, "PS5"); // 5800
```

### Python

```python
import requests

def convert_price(usd, platform="PS5"):
    response = requests.post(
        "https://reymidascr.com/api/price-converter",
        json={"priceUSD": usd, "platform": platform}
    )
    return response.json()

result = convert_price(19.99, "PS5")
print(f"Principal: {result['principal']} CRC")
```

### Bash / cURL

```bash
curl -X POST https://reymidascr.com/api/price-converter \
  -H "Content-Type: application/json" \
  -d '{"priceUSD": 19.99, "platform": "PS5"}'
```

---

## 📝 Estructura de datos

### Input (solicitud)

```json
{
  "priceUSD": 19.99,
  "platform": "PS5"
}
```

### Output (respuesta)

```json
{
  "priceUSD": 19.99,
  "platform": "PS5",
  "principal": 9500,
  "secundaria": 5800,
  "exchangeRate": 530,
  "pricingTable": [...],
  "source": "rey-midas-digitales",
  "timestamp": "2026-06-09T10:30:00.000Z"
}
```

---

## 🔧 Personalizar scripts

Todos los scripts usan la tabla de precios del archivo `app.js` (CONFIG.pricing).

Para cambiar multiplicadores o tipo de cambio:

1. Edita `/app.js` línea 33-46:
```javascript
const CONFIG = {
  exchangeRate: 530,        // cambiar aquí
  principalMarkup: 0.75,    // cambiar aquí
  secundariaMarkup: 0.35,   // cambiar aquí
  table: [
    [10, 4000,  2500],      // o aquí
    // ...
  ],
};
```

2. Los scripts usarán automáticamente los nuevos valores.

---

## 🔐 Seguridad y límites

- **Sin autenticación**: Los scripts puede usar la API pública
- **Sin rate limiting**: Por ahora sin restricciones
- **Sin CORS blocking**: Puedes llamarla desde cualquier origen

Si necesitas restringir acceso:
1. Implementar API key en `/api/price-converter`
2. Configurar CORS en `middleware.js`

---

## ⚡ Performance

- **HTTP requests**: ~50-200ms por conversión
- **Módulo directo**: ~1-2ms por conversión

**Recomendación**: Si necesitas convertir cientos de precios, usa el módulo directo en Node.js en lugar de hacer requests HTTP.

---

## 🐛 Troubleshooting

### "Método no permitido"
```json
{ "error": "Método no permitido. Usa POST." }
```
**Solución**: Usa `POST`, no `GET`

### "priceUSD inválido"
```json
{ "error": "priceUSD inválido. Debe ser un número >= 0." }
```
**Solución**: Asegúrate de enviar un número válido:
```javascript
{ priceUSD: 19.99 }  // ✓
{ priceUSD: "19.99" } // ✓ (será convertido)
{ priceUSD: "gratis" } // ✗ (error)
```

### La API no responde
- Verifica que estés usando `https://reymidascr.com/api/price-converter`
- Verifica que el servidor esté corriendo (dev: `http://localhost:3000/api/price-converter`)
- Revisa los logs: `git log --oneline | head -10`

---

## 📚 Documentación completa

Ver: `PRICE-CONVERTER-API.md`

---

## 💬 Preguntas

**¿Cómo integro esto en mi bot de Telegram?**
Ver: `telegram-userbot/README.md`

**¿Cómo creo ofertas automáticamente?**
Necesitas un endpoint en `/api/admin/offers` que valide y guarde ofertas en BD.

**¿Puedo usar esto en producción?**
Sí, es código estable. Asegúrate de:
1. Validar todos los inputs
2. Manejar errores de red
3. Cachear resultados si necesitas
4. Hacer rate limiting si es público
