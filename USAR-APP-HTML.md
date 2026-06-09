# 🚀 Cómo Usar la App HTML (Todo Integrado)

Tu app HTML **completa e independiente** lista para usar ahora mismo.

---

## 📁 Archivo

```
whatsapp-app-full.html
```

## ✨ ¿Qué incluye?

✅ Formulario para crear ofertas  
✅ Conversión automática USD → CRC  
✅ Tabla de ofertas con filtros  
✅ Estadísticas en tiempo real  
✅ Almacenamiento local (sin servidor)  
✅ Exportar a JSON  
✅ Diseño gamificado cyberpunk  

---

## 🎯 Cómo usar

### Opción 1: Abrir directamente

1. Descarga o copia el archivo `whatsapp-app-full.html`
2. Haz doble clic o arrastra a tu navegador
3. **¡Listo!** La app se abre en tu navegador

### Opción 2: Servir con un servidor

```bash
# Si tienes Python
python -m http.server 8000

# Si tienes Node.js
npx http-server

# Luego abre: http://localhost:8000/whatsapp-app-full.html
```

### Opción 3: Subir a tu dominio

1. Sube el archivo a tu hosting
2. Accede vía: `https://tu-dominio.com/whatsapp-app-full.html`

---

## 🎮 Cómo Funciona

### 1️⃣ Crear una Oferta

```
┌─────────────────────────────────────┐
│ ✨ NUEVA OFERTA                    │
├─────────────────────────────────────┤
│                                     │
│ Nombre del Juego:  [Baldur's Gate]  │
│ Plataforma:        [PS5 ▼]          │
│ Precio USD:        [49.99]          │
│ Descuento (%):     [10]             │
│                                     │
│ 💰 Precios en CRC:                  │
│   💳 Principal: ₡23.500             │ ← Automático
│   🎟️ Secundaria: ₡13.200            │ ← Automático
│                                     │
│ [📌 Crear Oferta] [Limpiar]        │
└─────────────────────────────────────┘
```

**Los precios se calculan automáticamente al escribir.**

---

### 2️⃣ Ver Tus Ofertas

```
┌──────────────────────────────────────────────────┐
│ 📋 MIS OFERTAS                                   │
├──────────────────────────────────────────────────┤
│ [Todas] [PlayStation] [Xbox] [Switch]           │
├──────────────────────────────────────────────────┤
│                                                  │
│ Juego          | Plat. | USD  | Principal | ... │
├──────────────────────────────────────────────────┤
│ Baldur's Gate 3│ PS5   | 49.99│ ₡23.500   | ... │
│ Elden Ring     │ Xbox  | 39.99│ ₡18.700   | ... │
│ Mario Wonder   │Switch | 59.99│ ₡31.875   | ... │
│                                                  │
│ [📥 Exportar a JSON]                            │
└──────────────────────────────────────────────────┘
```

**Filtra por plataforma con los tabs.**

---

### 3️⃣ Estadísticas

En el header ves:
- **Total Ofertas**: Cuántos juegos has añadido
- **Total CRC**: Suma de todos los precios principales

---

## 💾 ¿Dónde se guardan?

Las ofertas se guardan en el **localStorage del navegador** (gratis, sin servidor).

**Ventajas:**
- ✅ Funciona sin internet (offline)
- ✅ Rápido
- ✅ Privado (datos en tu navegador)

**Desventajas:**
- ❌ Se pierden si limpias el historial
- ❌ No se sincronizan entre dispositivos

**Consejo**: Usa el botón "Exportar a JSON" para hacer respaldo.

---

## 📊 Funciones Principales

### 📌 Crear Oferta
1. Llena los campos
2. Escribe el precio USD
3. Los precios CRC se calculan automáticamente
4. Click en "Crear Oferta"
5. ✅ Aparece en la tabla

### 🗑️ Eliminar Oferta
- Click en el botón "🗑️ Borrar" en la tabla
- Confirma
- Listo

### 🔍 Filtrar por Plataforma
- Click en los tabs: "Todas", "PlayStation", "Xbox", "Switch"
- Solo muestra las ofertas de esa plataforma

### 📥 Exportar a JSON
- Click en "📥 Exportar a JSON"
- Se descarga un archivo `ofertas-[timestamp].json`
- Puedes importarlo en otra app o compartirlo

---

## 🎨 Tabla de Conversión (Integrada)

| USD | PS5 Principal | PS5 Secundaria | Xbox Principal | Switch Principal |
|-----|---------------|----------------|----------------|------------------|
| $10 | ₡4,000 | ₡2,500 | ₡4,000 | ₡4,225 |
| $20 | ₡6,000 | ₡3,000 | ₡6,000 | ₡6,370 |
| $30 | ₡11,000 | ₡5,500 | ₡11,000 | ₡11,955 |
| $40 | ₡17,000 | ₡7,000 | ₡17,000 | ₡21,200 |
| $50 | ₡21,000 | ₡9,000 | ₡21,000 | ₡26,495 |

*La conversión es automática, cualquier precio funciona.*

---

## 🔧 Personalizar la App

Si quieres cambiar algo, edita el HTML:

### Cambiar tabla de precios

Busca en el código:
```javascript
const CONFIG = {
  exchangeRate: 530,  // ← Cambiar aquí si 1 USD ≠ 530 CRC
  table: [
    [10, 4000, 2500],
    [20, 6000, 3000],
    // Edita estos valores...
  ],
};
```

### Cambiar colores

Al inicio del CSS:
```css
:root {
  --m: #cc00ff;   /* Magenta */
  --c: #00cfff;   /* Cyan */
  --g: #00ff41;   /* Green */
  --y: #ffcc00;   /* Yellow */
}
```

---

## 💻 Ejemplo de Uso Completo

1. Abres `whatsapp-app-full.html`
2. Llenas: "Baldur's Gate 3", "PS5", "$49.99", "10% descuento"
3. **Automáticamente** aparece:
   - Principal: **₡23.500**
   - Secundaria: **₡13.200**
4. Click en "Crear Oferta"
5. ✅ Aparece en la tabla
6. Repites con más juegos
7. Exportas todo a JSON cuando termines

---

## 🚀 Próximos Pasos

### Si quieres guardar en servidor:

Modifica la función `addOffer()` para hacer POST a tu API:

```javascript
async function addOffer(e) {
  // ... código actual ...
  
  // En lugar de localStorage, envía a servidor:
  const res = await fetch("/api/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(offer)
  });
}
```

### Si quieres sincronizar con múltiples dispositivos:

Añade una base de datos (Supabase, Firebase, etc.)

```javascript
// Guardar en BD
await supabase.from('offers').insert([offer]);

// Cargar en BD
const { data } = await supabase.from('offers').select();
offers = data;
renderOffers();
```

---

## 🐛 Troubleshooting

### La app no abre

- ✅ Asegúrate de abrir con navegador (no al editor)
- ✅ Usa Chrome, Firefox, Safari o Edge
- ✅ Verifica que el archivo está intacto

### Los precios no se calculan

- ✅ Abre DevTools (F12 → Console)
- ✅ Escribe: `principalCRC(19.99, "PS5")` 
- ✅ Si no sale nada, recarga la página

### Las ofertas se borraron

- ✅ Probably limpiaste el historial/caché
- ✅ Las ofertas están en localStorage
- ✅ Usa "Exportar a JSON" para respaldo

---

## 📞 Soporte

¿Problemas?
- WhatsApp: +506 6146-8733
- Email: [tu email]
- GitHub Issues: [tu repo]

---

## 📚 Documentación Relacionada

- `PRICE-CONVERTER-API.md` — Si quieres integrar la API en otra app
- `INTEGRAR-EN-WHATSAPP-APP.md` — Para integrar en tu app existente
- `QUICK-START-PRICING.md` — Guía rápida general

---

**¡Tu app está lista! Abre el HTML y empieza a publicar ofertas. 🚀**
