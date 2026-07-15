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
| `GROQ_MODEL` | forzar un modelo de Groq | `llama-3.3-70b-versatile`, luego `llama-3.1-8b-instant` |
| `GEMINI_API_KEY` | clave de Gemini (alternativa) | — |
| `GEMINI_MODEL` | forzar un modelo de Gemini | autodescubre |

Si algún modelo dejara de existir, el `?selftest` lista los modelos disponibles
de tu clave para poder ajustar `GROQ_MODEL`/`GEMINI_MODEL`.

---

## Cómo cambiar lo que dice el asistente

La personalidad y el conocimiento viven en `api/chat.js`, función
`buildSystemPrompt()`. El catálogo se carga solo desde `featured-games.json`
con precios calculados automáticamente. Cuando el cliente está listo para
comprar, el asistente cierra con un botón **"Seguir por WhatsApp"** con el
pedido ya escrito.
