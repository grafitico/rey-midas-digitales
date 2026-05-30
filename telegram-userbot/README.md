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

## Deploy en Banahosting (SSH)

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
