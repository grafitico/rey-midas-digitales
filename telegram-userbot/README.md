# Telegram Userbot — bundles de @swichtaccount en tiempo real

Userbot MTProto que se loguea con **tu cuenta personal de Telegram** (no
un bot creado en BotFather), se suscribe al canal `@swichtaccount` y
commitea cada bundle nuevo a `nintendo-bundles.json` del repo. Vercel
detecta el push y redespliega → frontend al día sin tocar nada.

## Por qué userbot y no bot

Telegram **no permite que un bot lea mensajes enviados por otro bot**.
Como `@swaccountnube_bot` es del proveedor y nuestro hipotético bot no
puede leerlo, la única vía real-time es loguearse como **usuario**
(MTProto) y aprovechar que vos ya sos cliente del canal.

## Stack

- Node.js 18+
- [`telegram`](https://www.npmjs.com/package/telegram) (GramJS, cliente
  MTProto en JS).
- GitHub Contents API para commitear el JSON.

## Setup local (test)

```bash
cd telegram-userbot
npm install
cp .env.example .env
# Editá .env con TG_API_ID, TG_API_HASH (de my.telegram.org)
node login.js
# Te pide teléfono, código de Telegram y 2FA si tenés.
# Imprime la TG_SESSION — pegala en .env.
# Pegá también GITHUB_TOKEN (PAT con Contents: write) y GITHUB_REPO.
npm start
```

Si aparece "Escuchando mensajes nuevos..." y el siguiente post en el
canal aparece en los logs como bundle parseado, funciona.

## Modo más simple: GitHub Actions (sin servidor, desde la tablet)

Si no tenés acceso a una compu con SSH ahora, este es el camino. Todo
se hace desde el navegador de la tablet:

### 1) Sacar `TG_API_ID` y `TG_API_HASH`

Browser → https://my.telegram.org → log in con tu número → "API
development tools" → creá una app (cualquier nombre). Guardá los dos
valores.

### 2) Generar la `TG_SESSION` con GitHub Codespaces

Necesitamos correr `node login.js` una sola vez para generar la string
de sesión. Como es interactivo (pide código que llega por Telegram),
usamos Codespaces como compu temporal en el browser.

1. GitHub → este repo → botón verde **Code** → pestaña **Codespaces** →
   "Create codespace on `claude/busy-lamport-jP8JF`" (o `main` si ya se
   mergeó).
2. En el terminal del codespace:
   ```bash
   cd telegram-userbot
   npm install
   TG_API_ID=<id> TG_API_HASH=<hash> node login.js
   ```
3. Te pide número de teléfono → escribilo con código de país (ej
   `+50688887777`).
4. Telegram te manda un código a tu app de Telegram en la misma tablet
   → copialo y pegalo en el terminal del codespace.
5. Si tenés 2FA, te pide la contraseña.
6. Imprime una **session string** larga. Copiala completa (es como una
   contraseña — no la subas a ningún lado público).
7. Cerrá el codespace (Settings → Codespaces → delete). El free tier de
   GitHub te da 60h/mes, pero igual no necesitamos dejarlo prendido.

### 3) Cargar los secrets en el repo

GitHub → repo → **Settings → Secrets and variables → Actions** →
botón **New repository secret**, agregá tres:

| Nombre        | Valor                                       |
|---------------|---------------------------------------------|
| `TG_API_ID`   | el ID numérico del paso 1                   |
| `TG_API_HASH` | el hash del paso 1                          |
| `TG_SESSION`  | la string larga generada en el paso 2       |

No hace falta `GITHUB_TOKEN` — el workflow usa el token built-in del
runner con permiso `contents: write` (ya está configurado).

### 4) Activar el workflow

Si este branch ya está pusheado, el workflow `Sync bundles from
Telegram` aparece en la pestaña **Actions** del repo. Por defecto corre
todos los días a las 3 AM hora CR.

Probalo manualmente:
- Actions → "Sync bundles from Telegram" → **Run workflow** → Run.
- En segundos aparece el log. Si parseó bundles, vas a ver un commit
  nuevo en el repo y nintendo-bundles.json actualizado.

### Cambiar el horario

Editá `.github/workflows/sync-bundles.yml`, línea `cron: "0 9 * * *"`.
El cron es en UTC:
- `0 9 * * *` → 3:00 AM hora CR (diario)
- `0 */6 * * *` → cada 6 horas
- `0 * * * *` → cada hora

GitHub Actions tarda hasta 15 min en disparar crons frecuentes, no es
para real-time. Para diario/horario es perfecto.

---

## Modo alternativo: cron diario en Banahosting (one-shot)

Si **no necesitás real-time** (un sync por día/horas alcanza), es muchísimo
más simple que el modo always-on. No hay proceso persistente, no hay
tmux, no hay watchdog, no hay chance de que Banahosting flaguee la
cuenta.

`sync-once.js` conecta, lee los últimos N mensajes del canal (default
50, configurable con `SYNC_LIMIT`), parsea cada uno, commitea los
nuevos/actualizados a GitHub, y se cierra. Tarda unos segundos.

### Setup en Banahosting

```bash
ssh usuario@tu-host.banahosting.com
cd ~
git clone https://github.com/grafitico/rey-midas-digitales.git
cd rey-midas-digitales/telegram-userbot
npm install
cp .env.example .env
nano .env          # TG_API_ID, TG_API_HASH, GITHUB_TOKEN, GITHUB_REPO
node login.js      # genera la TG_SESSION (UNA vez, interactivo)
nano .env          # pegá la TG_SESSION
npm run sync       # probá que ande
```

### Agendar el cron

En cPanel → **Cron Jobs**, agregá:

```cron
0 3 * * * cd $HOME/rey-midas-digitales/telegram-userbot && /usr/bin/node sync-once.js >> $HOME/userbot.log 2>&1
```

Eso corre todos los días a las 3am. Cambialo a `0 */6 * * *` para cada
6 horas, `0 * * * *` para cada hora, etc.

Verificá el path real de Node con `which node` por SSH y reemplazalo si
no es `/usr/bin/node` (en Banahosting suele ser algo tipo
`/opt/cpanel/ea-nodejs18/bin/node`).

### Revisar que funcione

```bash
tail -f ~/userbot.log
```

Cada corrida imprime las estadísticas (`fetched`, `parsed`, `added`,
`updated`, `failed`).

---

## Modo alternativo: always-on (real-time)

Solo si necesitás que los bundles aparezcan **en segundos** y no podés
esperar al próximo cron. Es más fragil en hosting compartido.

### Deploy en Banahosting (SSH)

Asume que ya tenés acceso SSH habilitado en cPanel y Node.js disponible.
Si no hay Node, usá la sección "Setup Node.js App" del cPanel para que
te instale uno y obtener el path del binario.

```bash
ssh usuario@tuservidor.banahosting.com
cd ~
git clone https://github.com/grafitico/rey-midas-digitales.git
cd rey-midas-digitales/telegram-userbot
npm install
cp .env.example .env
nano .env   # pegá las credenciales
node login.js   # generá la TG_SESSION (interactivo, UNA vez)
nano .env   # pegá la TG_SESSION generada
```

Para correrlo always-on **sin que se muera al cerrar SSH**:

### Opción A: tmux (más simple)

```bash
tmux new -s userbot
npm start
# Ctrl+B luego D para "detach" sin matar el proceso.
# Para volver: tmux attach -t userbot
```

### Opción B: nohup + cron watchdog (más robusto)

```bash
nohup node index.js > ~/userbot.log 2>&1 &
```

Y en `crontab -e` agregá un watchdog que lo levanta si se murió:

```cron
*/5 * * * * pgrep -f "telegram-userbot/index.js" > /dev/null || (cd ~/rey-midas-digitales/telegram-userbot && nohup node index.js >> ~/userbot.log 2>&1 &)
```

### Opción C: pm2 (si está disponible)

```bash
npm i -g pm2
pm2 start index.js --name userbot
pm2 save
pm2 startup   # seguí las instrucciones que imprime
```

### Advertencia sobre hosting compartido

Banahosting Professional Deluxe es **hosting compartido**. Es posible
que su panel de procesos termine el userbot por inactividad de HTTP, o
que soporte lo flaguee si ven un proceso always-on. El watchdog del
crontab mitiga lo primero. Si después de unos días notás caídas
seguidas, movelo a Railway / Fly.io / VPS — el mismo código corre tal
cual.

## Deploy en Railway (fallback)

1. Conectá el repo en Railway → New Project → Deploy from GitHub.
2. Root directory: `telegram-userbot`.
3. Variables de entorno (Settings → Variables): pegá las mismas que del
   `.env`, incluyendo `TG_SESSION` (la generaste corriendo `node
   login.js` localmente, una sola vez).
4. Start command: `node index.js` (lo detecta solo del `package.json`).
5. Deploy. Logs en vivo en la pestaña Deployments.

## Cómo conseguir cada cosa

| Variable        | Dónde                                                                   |
|-----------------|-------------------------------------------------------------------------|
| TG_API_ID/HASH  | https://my.telegram.org → API development tools                         |
| TG_SESSION      | Output de `node login.js` (corrido una sola vez)                        |
| TG_CHANNEL      | `swichtaccount` (sin @) — o usá el ID numérico                          |
| GITHUB_TOKEN    | GitHub → Settings → Developer settings → Fine-grained PAT, Contents: RW |
| GITHUB_REPO     | `grafitico/rey-midas-digitales`                                         |

## Operación

- Cada mensaje nuevo en el canal genera un commit en `main`.
- Si el `id` del bundle ya existía, se actualiza preservando `coverUrl`.
- Si es nuevo, se agrega al inicio del array.
- Vercel redespliega en ~30-60s.
- El log imprime un heartbeat cada hora para verificar que sigue vivo.

## Cuando el formato del mensaje cambie

Hay UN solo parser (`parser.js`), espejo del que vive en
`../api/telegram-webhook.js`. Si el proveedor cambia el template,
ajustá los regex en ambos archivos.
