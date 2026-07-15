# Asistente virtual "Midas" — Guía de configuración

El sitio ahora tiene un **asistente virtual con IA** en la esquina inferior
derecha. Recomienda juegos, explica Cuenta Principal vs Secundaria, resuelve
dudas de Nintendo con tacto, y cierra mandando al cliente a WhatsApp con el
pedido ya armado. Atiende 24/7.

El "cerebro" es **Google Gemini** (capa gratuita). Para que funcione hay que
darle una clave de API. **Es gratis y toma 2 minutos.**

---

## Paso 1 — Crear la clave gratis de Gemini

1. Entrá a **https://aistudio.google.com/apikey** e iniciá sesión con tu
   cuenta de Google.
2. Tocá **"Create API key"** (Crear clave de API).
3. Copiá la clave que aparece (empieza con `AIza...`). **No la compartás con
   nadie** — es como una contraseña.

> No necesitás tarjeta de crédito. La capa gratuita alcanza de sobra para el
> tráfico de una tienda como la tuya.

---

## Paso 2 — Guardar la clave en Vercel

1. Entrá a tu proyecto en **https://vercel.com** → tu proyecto
   `rey-midas-digitales`.
2. Andá a **Settings → Environment Variables**.
3. Agregá una variable nueva:
   - **Name (nombre):** `GEMINI_API_KEY`
   - **Value (valor):** la clave que copiaste (`AIza...`)
   - **Environments:** dejá marcados los tres (Production, Preview, Development).
4. Tocá **Save**.
5. Andá a la pestaña **Deployments** → en el último deployment tocá los tres
   puntitos **⋯ → Redeploy** (para que tome la variable nueva).

Listo. En un par de minutos el asistente empieza a responder de verdad.

---

## ¿Cómo sé que quedó bien?

- Abrí **reymidascr.com**, tocá el botón dorado **"Asistente"** abajo a la
  derecha y escribí *"¿qué juego me recomendás?"*.
- Si responde con recomendaciones → **funciona**. 🎉
- Si dice *"el asistente está en mantenimiento"* → todavía falta la clave o el
  redeploy. Repasá los pasos 1 y 2.

---

## Ajustes opcionales

Todo se controla con variables de entorno en Vercel (Settings → Environment
Variables). Ninguna es obligatoria salvo `GEMINI_API_KEY`.

| Variable | Para qué sirve | Default |
|---|---|---|
| `GEMINI_API_KEY` | **(obligatoria)** la clave de Google Gemini | — |
| `GEMINI_MODEL` | forzar un modelo específico | prueba `gemini-2.5-flash`, luego `2.0-flash`, luego `1.5-flash` |

---

## ¿Cuánto cuesta?

**Nada** dentro de la capa gratuita de Gemini, que es generosa (miles de
mensajes por día). Si algún día el volumen creciera muchísimo, Google avisa y
podés activar facturación; pero para el tráfico normal de la tienda es gratis.

---

## Cómo cambiar lo que dice el asistente

El "conocimiento" y la personalidad viven en `api/chat.js`, en la función
`buildSystemPrompt()`. Ahí podés editar el tono, las reglas, precios,
políticas de garantía, etc. El catálogo de juegos se carga solo desde
`featured-games.json` (con precios calculados automáticamente).

Cuando el cliente está listo para comprar, el asistente cierra con un botón
**"Seguir por WhatsApp"** que abre el chat con el pedido ya escrito.
