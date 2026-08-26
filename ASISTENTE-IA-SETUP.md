# Asistente virtual "Midas" — Guía de configuración

El sitio tiene un **asistente virtual con IA** en la esquina inferior derecha.
Recomienda juegos, explica Cuenta Principal vs Secundaria, resuelve dudas de
Nintendo con tacto, y cierra mandando al cliente a WhatsApp con el pedido ya
armado. Atiende 24/7.

El "cerebro" es un modelo de IA. El asistente soporta **dos proveedores** y usa
el que tenga clave configurada en Vercel:

| Proveedor | Variable | Costo | Tarjeta |
|---|---|---|---|
| **Groq** (recomendado) | `GROQ_API_KEY` | Gratis | ❌ No requiere |
| Google Gemini | `GEMINI_API_KEY` | Depende de tu cuenta | A veces exige tarjeta |

> ⚠️ Gemini ofrece capa gratuita solo en algunas cuentas/países. Si tu cuenta
> devuelve `limit: 0`, Google te exige habilitar facturación (tarjeta). Por eso
> **recomendamos Groq**, que es gratis de verdad y sin tarjeta.

Si están las dos claves, gana Groq.

---

## Configurar Groq (gratis, sin tarjeta) — recomendado

### Paso 1 — Crear la clave gratis

1. Entrá a **https://console.groq.com/keys** e iniciá sesión (con Google o email).
2. Tocá **"Create API Key"**, ponele un nombre (ej. "reymidas") y **copiá** la
   clave (empieza con `gsk_...`). **No la compartás** — es como una contraseña.

> No pide tarjeta de crédito. La capa gratuita alcanza de sobra para el tráfico
> de una tienda.

### Paso 2 — Guardar la clave en Vercel

1. Entrá a **https://vercel.com** → tu proyecto `rey-midas-digitales`.
2. **Settings → Environment Variables**.
3. Agregá una variable:
   - **Name:** `GROQ_API_KEY`
   - **Value:** la clave (`gsk_...`)
   - **Environments:** Production y Preview (o los tres).
4. **Save**.
5. **Deployments** → en el último deployment: **⋯ → Redeploy** (para que tome la
   variable).

Listo. En un par de minutos el asistente responde.

---

## ¿Cómo sé que quedó bien?

Abrí en el navegador (una sola vez):

```
https://reymidascr.com/api/chat?selftest
```

- **`"ok": true`** → funciona. 🎉 Probá el chat en la web.
- **`"ok": false`** → el mensaje te dice el problema y cómo arreglarlo.

O directamente: abrí **reymidascr.com**, tocá **"Asistente"** y escribí
*"¿qué juego me recomendás?"*.

---

## Ajustes opcionales (variables de entorno)

| Variable | Para qué sirve | Default |
|---|---|---|
| `GROQ_API_KEY` | clave de Groq (recomendado) | — |
| `GROQ_MODEL` | forzar un modelo de Groq | `openai/gpt-oss-120b`, luego `openai/gpt-oss-20b` y `qwen/qwen3.8-27b` |
| `GEMINI_API_KEY` | clave de Gemini (alternativa) | — |
| `GEMINI_MODEL` | forzar un modelo de Gemini | autodescubre |
| `CHAT_TIMEOUT_MS` | cuánto espera cada intento contra el proveedor | `12000` (12s) |
| `CHAT_BUDGET_MS` | tope total de una consulta, sumando reintentos | `24000` (24s) |

Si algún modelo dejara de existir, el asistente lo detecta solo: pregunta a la
API qué modelos tiene tu clave y sigue respondiendo con el mejor disponible. El
`?selftest` te dice cuál quedó usando, por si querés fijarlo en `GROQ_MODEL`.

---

## Si el asistente devuelve errores

El chat nunca deja al cliente colgado: si el modelo falla, muestra un aviso con
botón **Reintentar** y el botón de WhatsApp. Para saber qué está pasando:

1. Abrí `https://reymidascr.com/api/chat?selftest` — te dice el problema en
   castellano (clave inválida, límite alcanzado, ningún modelo disponible).
2. Si querés el detalle exacto: Vercel → tu proyecto → **Logs**, filtrando por
   `[chat]`. Cada fallo deja una línea con su causa:

| Línea en los logs | Qué pasó | Qué hacer |
|---|---|---|
| `rate_limit` | se agotó la cuota del proveedor | esperar unos minutos; si se repite seguido, ver la nota de abajo |
| `bad_key` | la clave es inválida o está mal copiada | crear una nueva y hacer Redeploy |
| `timeout` | el proveedor no contestó a tiempo | casi siempre pasa solo; si se repite, probá otro `GROQ_MODEL` |
| `provider_error` | error del proveedor | el detalle va en la misma línea |

> **Los modelos se retiran cada tanto.** En agosto de 2026 Groq dio de baja los
> `llama-3.x` que usaba el asistente y el chat empezó a fallar en la primera
> pregunta. Ahora, si eso vuelve a pasar, el asistente pregunta a la API qué
> modelos quedan y sigue con el mejor sin que haya que tocar nada; el
> `?selftest` te dice cuál eligió por si lo querés fijar en `GROQ_MODEL`.

> **Sobre la cuota:** el catálogo viaja dentro de cada consulta, así que cuanto
> más largo es `featured-games.json`, menos consultas entran en la capa gratuita
> de Groq. Si empiezan a aparecer muchos `rate_limit`, la salida es recortar el
> catálogo destacado o pasar a un plan pago del proveedor.

---

## Cómo cambiar lo que dice el asistente

La personalidad y el conocimiento viven en `api/chat.js`, función
`buildSystemPrompt()`. El catálogo se carga solo desde `featured-games.json`
con precios calculados automáticamente. Cuando el cliente está listo para
comprar, el asistente cierra con un botón **"Seguir por WhatsApp"** con el
pedido ya escrito.
