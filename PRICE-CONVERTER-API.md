# API de Conversión de Precios 💰

Usa este endpoint para convertir precios USD → CRC automáticamente. Perfecto para publicar ofertas desde tu app externa o scripts.

## Endpoint

```
POST https://reymidascr.com/api/price-converter
```

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `priceUSD` | number | ✓ | Precio en USD (ej: 19.99) |
| `platform` | string | ✗ | Plataforma: "PS5", "PS4", "Xbox", "Switch" (default: "PS5") |

## Respuesta Exitosa (200)

```json
{
  "priceUSD": 19.99,
  "platform": "PS5",
  "principal": 9500,
  "secundaria": 5800,
  "exchangeRate": 530,
  "pricingTable": [
    [10, 4000, 2500],
    [20, 6000, 3000],
    ...
  ],
  "source": "rey-midas-digitales",
  "timestamp": "2026-06-09T10:30:00.000Z"
}
```

### Explicación de precios
- **principal** (CRC): Acceso completo. Juego se descarga en tu cuenta y está disponible offline para toda tu familia en la consola.
- **secundaria** (CRC): Más económico. Necesitas estar conectado a internet para jugar (game share activado).

## Ejemplos

### JavaScript / Node.js

```javascript
async function getPrice(usd, platform = "PS5") {
  const res = await fetch("https://reymidascr.com/api/price-converter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceUSD: usd, platform }),
  });
  return res.json();
}

// Uso
const price = await getPrice(19.99, "PS5");
console.log(`Principal: ${price.principal} CRC`);
console.log(`Secundaria: ${price.secundaria} CRC`);
```

### Python

```python
import requests

def get_price(usd, platform="PS5"):
    response = requests.post(
        "https://reymidascr.com/api/price-converter",
        json={"priceUSD": usd, "platform": platform}
    )
    return response.json()

# Uso
price = get_price(19.99, "PS5")
print(f"Principal: {price['principal']} CRC")
print(f"Secundaria: {price['secundaria']} CRC")
```

### cURL

```bash
curl -X POST https://reymidascr.com/api/price-converter \
  -H "Content-Type: application/json" \
  -d '{
    "priceUSD": 19.99,
    "platform": "PS5"
  }'
```

### Excel / Google Sheets

Usa esta fórmula para traer precios directamente en tus hojas de cálculo:

```
=IMPORTDATA("https://reymidascr.com/api/price-converter?usd=19.99&platform=PS5")
```

(Nota: esto retorna JSON; para Excel, considera usar una extensión o zapier).

## Errores

### 400 - Parámetro inválido

```json
{
  "error": "priceUSD inválido. Debe ser un número >= 0.",
  "example": { "priceUSD": 19.99, "platform": "PS5" }
}
```

### 405 - Método no permitido

```json
{
  "error": "Método no permitido. Usa POST."
}
```

### 500 - Error interno

```json
{
  "error": "Error interno del servidor"
}
```

## Casos de Uso

### 1. Publicar ofertas desde una app externa

Tu app puede:
1. Obtener precios USD de PlayStation Store / Xbox / Nintendo
2. Llamar a `/api/price-converter` para cada precio
3. Guardar automáticamente los precios en CRC
4. Publicar la oferta en reymidascr.com

```javascript
async function publishOffer(gameData) {
  const converted = await getPrice(gameData.priceUSD, gameData.platform);
  
  // Crear oferta en tu BD
  await createOffer({
    title: gameData.title,
    platform: gameData.platform,
    priceUSD: gameData.priceUSD,
    priceCRC_principal: converted.principal,
    priceCRC_secundaria: converted.secundaria,
    discount: gameData.discount,
  });
}
```

### 2. Script de actualización de precios

```javascript
// Actualizar todos los precios en la BD
async function updateAllPrices() {
  const games = await getAllGames();
  
  for (const game of games) {
    const converted = await getPrice(game.priceUSD, game.platform);
    await updateGame(game.id, {
      priceCRC_principal: converted.principal,
      priceCRC_secundaria: converted.secundaria,
    });
  }
}
```

### 3. Sistema de alertas de precios

Monitorea PSN/Xbox y notifica cuando hay descuentos:

```javascript
async function checkDiscount(title, currentUSD, originalUSD, platform) {
  const current = await getPrice(currentUSD, platform);
  const original = await getPrice(originalUSD, platform);
  
  const savings = original.principal - current.principal;
  const discountPct = Math.round((savings / original.principal) * 100);
  
  console.log(`${title}: Ahorrás ${savings} CRC (${discountPct}%)`);
}
```

## Notas Técnicas

- **Sin autenticación**: El endpoint es público. Ideal para herramientas y bots.
- **Sin límite de rate**: Por ahora sin restricciones. Si abusas, pondremos límites.
- **Tabla dinámica**: La tabla de precios está definida en tu configuración (`CONFIG.pricing.table` en `app.js`).
- **Multiplicadores**: 
  - PS/Xbox: usa interpolación lineal (tabla)
  - Switch / Otras: usa `exchangeRate × multiplicador`
  - Principal: 75% de markup
  - Secundaria: 35% de markup

## Cambiar la Tabla de Precios

Los precios están en `/app.js` línea 33-46:

```javascript
const CONFIG = {
  exchangeRate: 530,      // 1 USD = 530 CRC
  principalMarkup: 0.75,  // 75% para Switch/otras
  secundariaMarkup: 0.35, // 35% para Switch/otras
  table: [
    [10, 4000,  2500],    // $10 → ₡4000 (principal) o ₡2500 (secundaria)
    [20, 6000,  3000],
    // ...
  ],
};
```

**Cambio de tabla de precios** → Afecta:
1. Frontend (app.js)
2. Middleware (middleware.js)
3. API de conversión (api/price-converter.js)
4. Scripts de utilidad

Para mantener todo sincronizado, edita solo `/api/pricing-utils.mjs` (la fuente única de verdad).

## FAQ

**¿Puedo usar esto desde un script de Node.js?**
Sí. Si lo ejecutas en el servidor, importa `api/pricing-utils.mjs`:
```javascript
import { principalCRC, secundariaCRC } from './api/pricing-utils.mjs';
```

**¿Puedo publicar ofertas desde mi app?**
Sí, pero necesitas autenticación en `/api/admin/offers` o similar. Contacta al equipo.

**¿Qué tan rápido es?**
Instant. No consulta BD ni APIs. Solo cálculos matemáticos (~1-2ms).

**¿Puedo integrar esto en un bot de Telegram?**
Sí, perfectamente. Mira el ejemplo en `telegram-userbot/parser.js`.

---

**¿Preguntas? Escribe por WhatsApp** → +506 6146-8733
