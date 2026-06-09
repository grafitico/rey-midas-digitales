# 🚀 Guía de Inicio Rápido — Conversión de Precios

Publica ofertas y convierte precios USD → CRC en minutos.

---

## 5️⃣ PASOS PARA EMPEZAR

### 1️⃣ Opción A: Usar la API HTTP (desde cualquier app)

```javascript
// Instala fetch (Node.js, Deno, navegador)
const response = await fetch("https://reymidascr.com/api/price-converter", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    priceUSD: 19.99,
    platform: "PS5"
  })
});

const data = await response.json();
console.log(`Principal: ${data.principal} CRC`);      // 9500
console.log(`Secundaria: ${data.secundaria} CRC`);    // 5800
```

**Ventaja**: Funciona desde cualquier lenguaje y ambiente

---

### 1️⃣ Opción B: Importar módulo directamente (Node.js)

```javascript
import { principalCRC, secundariaCRC } from './api/pricing-utils.mjs';

const principal = principalCRC(19.99, "PS5");     // 9500
const secundaria = secundariaCRC(19.99, "PS5");   // 5800
```

**Ventaja**: Más rápido, sin llamadas HTTP

---

### 2️⃣ Convertir múltiples precios

```javascript
import { convertPrice } from './api/pricing-utils.mjs';

const games = [
  { title: "Elden Ring", priceUSD: 59.99, platform: "PS5" },
  { title: "Starfield", priceUSD: 69.99, platform: "Xbox" },
];

const converted = games.map(g => ({
  ...g,
  ...convertPrice(g.priceUSD, g.platform)
}));

converted.forEach(g => {
  console.log(`${g.title}: ${g.principal} CRC`);
});
```

---

### 3️⃣ Ejecutar scripts de ejemplo

```bash
# Opción 1: Convertir precios via API
node scripts/convert-prices-example.js

# Opción 2: Convertir en lote (con archivo de salida)
node scripts/batch-convert-offers.mjs

# Opción 3: Simular publicación de ofertas
node scripts/publish-offers-example.mjs
```

---

### 4️⃣ Integrar en tu app

#### Python
```python
import requests

res = requests.post(
    "https://reymidascr.com/api/price-converter",
    json={"priceUSD": 19.99, "platform": "PS5"}
)
data = res.json()
print(f"Principal: {data['principal']} CRC")
```

#### Bash / cURL
```bash
curl -X POST https://reymidascr.com/api/price-converter \
  -H "Content-Type: application/json" \
  -d '{"priceUSD": 19.99, "platform": "PS5"}'
```

#### Google Sheets / Excel
Crea una columna con precios USD y usa:
```
=IMPORTDATA("https://reymidascr.com/api/price-converter?usd=19.99&platform=PS5")
```

---

### 5️⃣ Publicar tu primera oferta

```javascript
async function createOffer(title, priceUSD, platform) {
  // 1. Convertir precio
  const res = await fetch("https://reymidascr.com/api/price-converter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceUSD, platform })
  });
  const pricing = await res.json();

  // 2. Guardar en tu BD
  const offer = {
    title,
    platform,
    priceUSD,
    priceCRC_principal: pricing.principal,
    priceCRC_secundaria: pricing.secundaria,
    published_at: new Date().toISOString()
  };

  // 3. Enviar a tu API
  // await saveToDatabase(offer);
  console.log("✅ Oferta creada:", offer);
  return offer;
}

// Uso
await createOffer("Baldur's Gate 3", 49.99, "PS5");
```

---

## 📊 Tabla de Referencia Rápida

| USD | PS5 Principal | PS5 Secundaria | Xbox Principal | Switch Principal |
|-----|---------------|----------------|----------------|------------------|
| $10 | ₡4,000 | ₡2,500 | ₡4,000 | ₡4,225 |
| $20 | ₡6,000 | ₡3,000 | ₡6,000 | ₡6,370 |
| $30 | ₡11,000 | ₡5,500 | ₡11,000 | ₡11,955 |
| $40 | ₡17,000 | ₡7,000 | ₡17,000 | ₡21,200 |
| $50 | ₡21,000 | ₡9,000 | ₡21,000 | ₡26,495 |
| $60 | ₡26,000 | ₡13,000 | ₡26,000 | ₡31,790 |
| $70 | ₡28,500 | ₡15,000 | ₡28,500 | ₡37,085 |

*Nota: Switch y otras plataformas usan 75% de markup (principal) y 35% (secundaria)*

---

## ❓ Preguntas Frecuentes

**P: ¿Qué es "Principal" vs "Secundaria"?**
- **Principal**: Acceso completo. Juego se descarga en tu cuenta, disponible offline. Podés compartirlo en la misma consola.
- **Secundaria**: Acceso compartido (game share). Necesitas conexión de internet para jugar.

**P: ¿Puedo cambiar los precios?**
- Sí. Edita `/app.js` línea 33-46 en `CONFIG.pricing`. Los scripts usarán automáticamente los nuevos valores.

**P: ¿Hay límite de conversiones por día?**
- No. La API es pública y sin límites (de momento).

**P: ¿Funciona desde una app mobile?**
- Sí. La API funciona desde cualquier ambiente: web, mobile, server, etc.

**P: ¿Cómo automatizo esto?**
- Crea un webhook que escuche cambios en PSN/Xbox, llame a la API, y publique ofertas automáticamente.

**P: ¿Puedo resguardar mis conversiones?**
- Sí. Guarda los resultados en tu BD y cachea por 1 hora.

---

## 🔗 Documentación Completa

- **API Completa**: `PRICE-CONVERTER-API.md`
- **Scripts**: `scripts/PRICING-SCRIPTS-README.md`
- **Ejemplos**: `scripts/` (3 ejemplos listos para copiar/pegar)

---

## 🎯 Próximos Pasos

1. ✅ Copia un script de ejemplo
2. ✅ Integra la API en tu app
3. ✅ Publica tu primera oferta
4. ✅ Automatiza con webhooks o cron jobs
5. ✅ Monitorea con analytics

---

## 💬 ¿Necesitas ayuda?

- **Documentación**: Lee `PRICE-CONVERTER-API.md`
- **Ejemplos**: Mira los scripts en `scripts/`
- **WhatsApp**: +506 6146-8733

---

## 📌 Resumen de URLs

| Recurso | URL |
|---------|-----|
| **API de conversión** | `POST https://reymidascr.com/api/price-converter` |
| **Sitio oficial** | `https://reymidascr.com` |
| **WhatsApp** | `+506 6146-8733` |
| **Módulo de pricing** | `./api/pricing-utils.mjs` |

---

**¡Listo para publicar ofertas! 🚀**
