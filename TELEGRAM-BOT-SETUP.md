# Bot de Telegram — sincronización de bundles Nintendo en tiempo real

Este flujo recibe los posts del canal `@swichtaccount` vía webhook de
Telegram, parsea cada mensaje en un objeto bundle y commitea el JSON
actualizado a este mismo repo. Vercel detecta el push y redespliega
automáticamente, dejando el frontend al día sin intervención manual.

## Arquitectura

```
Canal Telegram ──▶ Bot (admin del canal) ──▶ POST /api/telegram-webhook
                                                       │
                                                       ▼
                                            Parsea mensaje → bundle
                                                       │
                                                       ▼
                                  GitHub API: PUT nintendo-bundles.json
                                                       │
                                                       ▼
                                       Vercel auto-redeploy → frontend
```

## Contexto

- Canal fuente: **@swichtaccount** — ahí publica los bundles el proveedor.
- Bot del proveedor: **@swaccountnube_bot** — es el bot que el proveedor
  usa para consultar/extraer los bundles del canal. **No lo usamos
  directamente**: la Bot API de Telegram prohíbe que un bot lea mensajes
  enviados por otro bot. Nuestra integración apunta directo al canal.

## Requisito clave

Un bot de Telegram **solo puede leer mensajes de un canal si está
agregado como administrador de ese canal**. El dueño de @swichtaccount
(el proveedor) tiene que agregar nuestro bot como admin (basta con todos
los permisos desactivados; solo necesitamos lectura). Sin ese paso,
Telegram nunca nos enviará los `channel_post`.

Si el proveedor no puede agregarlo como admin, la alternativa es
scrapear el preview público `https://t.me/s/swichtaccount` con un cron
(no es tiempo real, pero no requiere permisos).

## Setup paso a paso

### 1) Crear el bot

1. En Telegram, hablale a [@BotFather](https://t.me/BotFather).
2. `/newbot` → escogé nombre y username (ej: `ReyMidasBundlesBot`).
3. Guardá el **token** que te da (formato `123456:ABC-DEF...`).
4. `/setprivacy` → elegí el bot → **Disable** (importante para que reciba
   todos los posts del canal, no solo los que lo mencionan).

### 2) Agregar el bot al canal

El dueño del canal tiene que:
1. Abrir el canal → "Administradores" → "Agregar administrador".
2. Buscar el username del bot y agregarlo.
3. Desactivar todos los permisos (no necesitamos postear nada, solo
   leer). Telegram igual lo deja como admin de solo-lectura.

### 3) Generar el secret del webhook

Un string aleatorio largo, ej:

```bash
openssl rand -hex 32
```

### 4) Crear un Personal Access Token de GitHub

Necesitamos un PAT con permiso de escritura sobre este repo para
commitear el JSON.

1. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token.
2. Repository access: solo `grafitico/rey-midas-digitales`.
3. Repository permissions → **Contents: Read and write**.
4. Guardá el token.

### 5) Variables de entorno en Vercel

En Vercel → el proyecto → Settings → Environment Variables, agregá:

| Variable                  | Valor                                                       |
|---------------------------|-------------------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`      | token que dio @BotFather                                    |
| `TELEGRAM_WEBHOOK_SECRET` | string aleatorio del paso 3                                 |
| `TELEGRAM_CHANNEL_ID`     | (opcional) id numérico del canal, ej `-1001234567890`       |
| `GITHUB_TOKEN`            | PAT del paso 4                                              |
| `GITHUB_REPO`             | `grafitico/rey-midas-digitales`                             |
| `GITHUB_BRANCH`           | (opcional) default `main`                                   |
| `PUBLIC_BASE_URL`         | URL pública del sitio, ej `https://reymidas.cr`             |

Redeploy después de agregarlas.

### 6) Registrar el webhook contra Telegram

Como admin del sitio (logueado), hacé `POST /api/telegram-webhook?setup`:

```bash
curl -X POST "https://reymidas.cr/api/telegram-webhook?setup" \
  -H "Authorization: Bearer <tu_session_token>"
```

Verificá con `GET`:

```bash
curl "https://reymidas.cr/api/telegram-webhook?setup" \
  -H "Authorization: Bearer <tu_session_token>"
```

Debería mostrar `url`, `pending_update_count: 0` y `last_error_date`
vacío.

Para borrarlo: `DELETE "https://reymidas.cr/api/telegram-webhook?setup"`.

> Nota: la administración del webhook vive en `/api/telegram-webhook?setup`
> (antes era `/api/telegram-setup`). Se unificaron en un solo endpoint para
> respetar el límite de funciones del plan de Vercel.

## Formato de mensaje esperado

El parser detecta:

- **ID**: `ID: 08DN81` o `Código: 08DN81` o un alfanumérico de 6 chars
  suelto en el texto.
- **Precio**: `Precio: ₡20.000` (o "colones", "CRC").
- **Tamaño total**: `Tamaño: 110.0gb` o `Total: 110gb`.
- **Juegos**: líneas que empiezan con `-`, `*`, `•`, etc. Si terminan
  con `(48.0 gb)` o `[48 gb]` lo toma como tamaño individual.

Ejemplo válido:

```
ID: 08DN81
Precio: ₡20.000
Tamaño: 110.0gb
Juegos:
- Mortal Kombat 1 (48.0 gb)
- Mortal Kombat 11 (42.9 gb)
- Overcooked! All You Can Eat (15.5 gb)
- Cuphead (3.6 gb)
```

Si el proveedor usa otro formato, hay que ajustar los regex en
`api/telegram-webhook.js` (función `parseBundle`).

## Comportamiento

- Si llega un bundle con un `id` que **ya existe** en
  `nintendo-bundles.json`, se actualiza (preservando `coverUrl` si tenía
  uno cargado manualmente).
- Si el `id` es nuevo, se inserta al inicio de la lista.
- El commit aparece como `chore(bundles): added 08DN81 via telegram
  webhook` o `updated 08DN81 via telegram webhook`.
- Vercel auto-redespliega en ~30-60s; ahí el frontend ya muestra el
  bundle nuevo.

## Debug

- `pending_update_count > 0` en `getWebhookInfo` → Telegram tiene
  updates pendientes que nuestro endpoint rechazó.
- `last_error_message` → leelo, suele ser claro (401 = secret malo,
  500 = error en parser o en GitHub API).
- Logs en Vercel → Functions → `api/telegram-webhook` para ver qué
  parseó y qué commiteó.
