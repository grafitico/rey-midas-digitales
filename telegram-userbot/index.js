// Userbot principal. Conecta a Telegram con la session string guardada,
// se suscribe a mensajes nuevos del canal @swichtaccount, parsea cada
// post como bundle y lo commitea a nintendo-bundles.json en GitHub.
//
// Pensado para correr always-on en SSH/Banahosting/Railway:
//   nohup node index.js > userbot.log 2>&1 &
// o vía pm2 / systemd / tmux.

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { parseBundle } from "./parser.js";
import { upsertBundle } from "./github.js";

const apiId = parseInt(process.env.TG_API_ID || "", 10);
const apiHash = process.env.TG_API_HASH || "";
const sessionStr = process.env.TG_SESSION || "";
const channel = process.env.TG_CHANNEL || "swichtaccount";

if (!apiId || !apiHash) {
  console.error("Faltan TG_API_ID / TG_API_HASH");
  process.exit(1);
}
if (!sessionStr) {
  console.error("Falta TG_SESSION. Corré `node login.js` primero para generarla.");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
  connectionRetries: 999,
  autoReconnect: true,
});

await client.connect();
console.log(`[${ts()}] Conectado a Telegram. Resolviendo canal @${channel}…`);

const channelEntity = await client.getEntity(channel);
console.log(`[${ts()}] Canal resuelto: ${channelEntity.title} (id ${channelEntity.id})`);
console.log(`[${ts()}] Escuchando mensajes nuevos…`);

client.addEventHandler(async (event) => {
  try {
    const msg = event.message;
    if (!msg) return;
    const text = msg.message || "";
    if (!text) return;

    const bundle = parseBundle(text);
    if (!bundle) {
      console.log(`[${ts()}] Mensaje ignorado (no se detectó bundle). Primeros 80c: ${text.slice(0, 80).replace(/\n/g, " ⏎ ")}`);
      return;
    }

    console.log(`[${ts()}] Bundle detectado: ${bundle.id} (₡${bundle.priceCRC}, ${bundle.games.length} juegos)`);
    const result = await upsertBundle(bundle);
    console.log(`[${ts()}] Commit OK: ${result.action} ${bundle.id}`);
  } catch (e) {
    console.error(`[${ts()}] Error procesando mensaje:`, e.message);
  }
}, new NewMessage({ chats: [channelEntity] }));

// Logs de salud cada hora para confirmar que sigue vivo.
setInterval(() => {
  console.log(`[${ts()}] Heartbeat: userbot conectado, escuchando @${channel}.`);
}, 60 * 60 * 1000);

process.on("SIGINT", async () => {
  console.log(`[${ts()}] Cerrando por SIGINT…`);
  await client.disconnect();
  process.exit(0);
});

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
