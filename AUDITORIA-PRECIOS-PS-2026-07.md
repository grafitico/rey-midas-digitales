# Auditoría de precios — PlayStation (julio 2026)

Alcance: lógica de precios del catálogo PS (`app.js` `CONFIG.pricing` + `interpolateCRC` / `principalCRC` / `secundariaCRC`) contrastada con los datos reales de `ps-catalog.json` (16,710 juegos, `updatedAt` 2026‑07‑15, tipo de cambio configurado ₡530/USD).

Los tres síntomas reportados por el negocio se reproducen con los datos y tienen **una causa raíz común**: la tabla de interpolación de precios (`app.js:37-46`) tiene un **piso** en el extremo barato y un **cruce** en el extremo caro, y no se compara nunca contra el precio vigente de la tienda oficial.

---

## Cómo se calcula hoy el precio

`app.js:37-46` — tabla `[usd, principal, secundaria]`:

```
[10, 4000,  2500]
[20, 6000,  3000]
[30, 11000, 5500]
[40, 17000, 7000]
[50, 21000, 9000]
[60, 26000, 13000]
[70, 28500, 15000]
[80, 36000, 14000]
```

`interpolateCRC` (`app.js:4449`) interpola linealmente entre filas y **extrapola** por fuera del rango \[10, 80]. `roundTo500` redondea a ₡500. El precio parte del **`priceUSD` ya con descuento** de PSN, pero **nunca se compara contra `priceUSD × 530`** (lo que costaría comprarlo uno mismo en la tienda hoy).

Punto de equilibrio (tabla vs. oficial `priceUSD×530`):

| USD | principal | secundaria | oficial ×530 | ¿principal más caro? |
|----:|----------:|-----------:|-------------:|:--------------------:|
| 0.19 | 2 000 | 2 000 | 101 | ⚠️ +1880% |
| 1.00 | 2 000 | 2 000 | 530 | ⚠️ +277% |
| 2.00 | 2 500 | 2 000 | 1 060 | ⚠️ +136% |
| 3.00 | 2 500 | 2 000 | 1 590 | ⚠️ +57% |
| 4.00 | 3 000 | 2 000 | 2 120 | ⚠️ +42% |
| 5.00 | 3 000 | 2 500 | 2 650 | ⚠️ +13% |
| **6.00** | 3 000 | 2 500 | 3 180 | ✅ −6% |
| 10.00 | 4 000 | 2 500 | 5 300 | ✅ −25% |
| 60.00 | 26 000 | 13 000 | 31 800 | ✅ −18% |
| 80.00 | 36 000 | 14 000 | 42 400 | ✅ −15% |
| 110.00 | 58 500 | 13 000 | 58 300 | ⚠️ +0.3% |
| 160.00 | 96 000 | 12 000 | 84 795 | ⚠️ +13% |

**Regla que sale de los datos:** por debajo de **~$6** (principal) y **~$4** (secundaria) nuestro precio supera al de la tienda oficial. Por encima de **~$109** vuelve a superarlo (extrapolación del extremo alto).

---

## 🔴 Hallazgo 1 — Más caros que la tienda oficial (cuenta primaria)

Con la tabla actual, **5 504 de 16 710 juegos** (el ~49% de los que tienen precio) quedan en cuenta **principal más caros** que comprándolos directo en PSN al precio de oferta vigente. En **secundaria** son **3 528** juegos.

Peores casos (ratio nuestro/oficial):

| Nuestro (principal) | Oficial (oferta) | Juego |
|--------------------:|-----------------:|-------|
| ₡2 000 | ₡11 | Destroy All Humans! Clone Carnage ($0.02) |
| ₡2 000 | ₡101 | Everlune / Bunny Reversi ($0.19) |
| ₡2 000 | ₡127 | Galactic Lords, Multigun, Sqwrk… ($0.24) |

**Causa:** el piso de ₡2 000 de la extrapolación (a USD→0 la fórmula da `200·usd + 2000`, redondeado a ₡2 000) contra un precio oficial que puede ser de centavos. El cliente que compara ve que le sale más barato comprarlo él mismo → mata la confianza justo en el gancho de "ahorrás X%".

Nota: el badge "Ahorrás X% vs PSN" (`app.js:1083-1097`) compara contra el **precio original** (`originalPriceUSD × 530`), **no** contra el precio de oferta vigente, así que muestra un ahorro que en realidad no existe cuando el juego está en oferta profunda.

---

## 🔴 Hallazgo 2 — Juegos con diferencias enormes / "super baratos"

Datos del catálogo:

- **493** juegos con ≥85% de descuento, **265** con ≥90%.
- **650** juegos con `priceUSD < $1`; **144** por debajo de **$0.50**.

Estos precios **son reales** de la PS Store es‑cr (no hay inconsistencias de datos: 0 juegos con descuento mal calculado, 0 con `onSale` incoherente). El problema es doble:

1. Casi todo ese segmento es **shovelware** (juegos de relleno tipo "Bunny Reversi", "Sqwrk", "Neodarlo") que ensucia el catálogo y la percepción de la marca.
2. Combinado con el Hallazgo 1, esos mismos juegos aparecen **a ₡2 000 fijos** cuando en realidad valen ₡100–₡700 → es el origen visible de "diferencias muy grandes".

---

## 🔴 Hallazgo 3 — Mismo juego/"versión" con varios precios

**33 grupos** de **mismo título + misma plataforma** con `priceUSD` distinto (y **95 grupos** de título+plataforma duplicados en total). No son un bug de cálculo: son **SKUs distintos** (Standard / Deluxe / Bundle / edición) que **comparten exactamente el mismo título** en el catálogo, por lo que en la web se ven como "el mismo juego a 2–3 precios".

Ejemplos:

| Título mostrado | Entradas | Precios USD | Qué son en realidad |
|---|---|---|---|
| Outbreak: Shades of Horror Chromatic Split [PS5] | 3 | 44.99 / 64.99 / 89.99 | 3 bundles distintos |
| Vagrus - The Riven Realms [PS5] | 3 | 17.99 / 29.99 / 38.24 | full‑game + 2 ediciones |
| Sifu [PS5/PS4] | 2 | 9.99 / 44.99 | juego base + edición |
| Cronos: The New Dawn [PS5] | 2 | 35.99 / 69.99 | base + Deluxe |
| Creed: Rise to Glory [PS5] | 2 | 13.99 / 49.99 | base + Championship Ed. |

**Causa:** el `type` (`full-game` / `edition` / `bundle`) existe en los datos pero **no se refleja en el título ni se deduplica** al renderizar. Tres tarjetas idénticas con precios diferentes = exactamente lo reportado.

---

## 🟡 Hallazgo 4 — Defectos en la propia tabla (bonus)

1. **Extremo alto se cruza:** por encima de ~$109 la extrapolación vuelve a dejar el precio principal por encima del oficial (**36 juegos**, p. ej. Microsoft Flight Simulator 2024 ₡96 000 vs ₡84 795 oficial).
2. **Secundaria no monotónica:** la fila $70 da secundaria ₡15 000 pero la fila $80 da ₡14 000 (**baja**). Al extrapolar, un juego de $100 sale a ₡12 000 en secundaria — más barato que uno de $50 (₡9 000)… pero también que uno de $70. La columna secundaria del extremo alto está descalibrada.

---

## Recomendaciones (por impacto)

### 1. Nunca superar el precio oficial vigente — *fix de una línea, resuelve Hallazgos 1 y 4*
Topar el precio calculado contra el precio de oferta vigente:

```js
function principalCRC(usd, platform = "") {
  const base = /PS|Xbox/i.test(platform)
    ? interpolateCRC(usd, 0)
    : Math.round(usd * CONFIG.pricing.exchangeRate * CONFIG.pricing.principalMarkup);
  const oficial = usd * CONFIG.pricing.exchangeRate;
  return Math.min(base, roundTo500(oficial)); // nunca más caro que comprarlo uno mismo
}
```
Garantiza que **jamás** aparezcamos más caros que PSN. (Decisión de negocio: si en cuenta primaria hay un mínimo de servicio, usar `min(base, oficial)` solo cuando `oficial < base`, o fijar un piso explícito bajo — ver punto 3.)

### 2. Filtrar shovelware / piso de calidad — *resuelve Hallazgo 2*
Ocultar del catálogo los juegos con `originalPriceUSD` por debajo de un umbral (p. ej. **< $5**) o con `priceUSD < $2`, salvo excepciones curadas. Reutilizar el mecanismo de `hidden-games.json` o añadir un filtro en el `sync-ps-catalog.js`. Recorta ~650 títulos de relleno.

### 3. Recalibrar la tabla de precios — *decisión de negocio*
Revisar el piso (hoy ₡2 000) y la columna secundaria del extremo alto (₡14 000/₡15 000 no monotónica). Definir un **precio mínimo explícito** por método (primaria/secundaria) en vez de que salga de la extrapolación.

### 4. Desambiguar ediciones — *resuelve Hallazgo 3*
Dos opciones (no excluyentes):
- **Deduplicar** por `title+platform` quedándose con el SKU base (`type==="full-game"`, menor precio) y mover ediciones/bundles a su propia sección.
- **Anexar el `type`/edición al título** (`Sifu — Edición Vengeance`) para que se vean como productos distintos y no como "el mismo a 2 precios".

---

## Resumen cuantitativo

| Hallazgo | Métrica | Datos |
|---|---|---|
| 1 — Más caros que oficial | Juegos afectados (principal / secundaria) | **5 504 / 3 528** |
| 2 — Super baratos / shovelware | Juegos `< $1` / `< $0.50` / ≥90% off | **650 / 144 / 265** |
| 3 — Mismo título, distinto precio | Grupos título+plataforma | **33** (95 duplicados en total) |
| 4 — Defectos de tabla | Cruce alto ($>109) / secundaria no monotónica | **36** / sí |
