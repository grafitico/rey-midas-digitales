// Modo one-shot: conecta, lee los últimos N mensajes del canal,
// parsea cada uno como bundle y commitea los nuevos/actualizados a
// GitHub. Termina. Pensado para correr desde el cron de cPanel
// (Banahosting) o cualquier otro scheduler.
//
// Ej cron diario a las 3am:
//   0 3 * * * cd ~/rey-midas-digitales/telegram-userbot && /usr/bin/node sync-once.js >> ~/userbot.log 2>&1
//
// LIMIT controla cuántos mensajes recientes barre cada corrida. Subilo
// si el cron es menos frecuente o el canal postea mucho.

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { parseBundle } from "./parser.js";
import { upsertBundle } from "./github.js";

const apiId = parseInt(process.env.TG_API_ID || "", 10);
const apiHash = process.env.TG_API_HASH || "";
const sessionStr = process.env.TG_SESSION || "";
const channel = process.env.TG_CHANNEL || "swichtaccount";
const LIMIT = parseInt(process.env.SYNC_LIMIT || "50", 10);

if (!apiId || !apiHash || !sessionStr) {
  console.error(`[${ts()}] Faltan TG_API_ID / TG_API_HASH / TG_SESSION en .env`);
  process.exit(1);
}

const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
  connectionRetries: 3,
});

const stats = { fetched: 0, parsed: 0, added: 0, updated: 0, failed: 0 };

try {
  await client.connect();
  console.log(`[${ts()}] Conectado. Buscando últimos ${LIMIT} mensajes de @${channel}…`);

  const entity = await client.getEntity(channel);
  const messages = await client.getMessages(entity, { limit: LIMIT });
  stats.fetched = messages.length;

  // Procesamos en orden cronológico (los más viejos primero) para que
  // el "unshift" del JSON deje los más nuevos arriba.
  for (const msg of messages.reverse()) {
    const text = msg?.message || "";
    if (!text) continue;
    const bundle = parseBundle(text);
    if (!bundle) continue;
    stats.parsed++;
    try {
      const r = await upsertBundle(bundle);
      stats[r.action === "added" ? "added" : "updated"]++;
      console.log(`[${ts()}]   ${r.action} ${bundle.id} (₡${bundle.priceCRC}, ${bundle.games.length} juegos)`);
    } catch (e) {
      stats.failed++;
      console.error(`[${ts()}]   FAIL ${bundle.id}: ${e.message}`);
    }
  }

  console.log(`[${ts()}] Listo. ${JSON.stringify(stats)}`);
} catch (e) {
  console.error(`[${ts()}] Error fatal: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.disconnect().catch(() => {});
  process.exit(process.exitCode || 0);
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
