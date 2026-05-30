// Script de login interactivo. Se corre UNA sola vez en el host.
//
//   node login.js
//
// Te pide número de teléfono, código que llega por Telegram y (si aplica)
// contraseña 2FA. Al terminar imprime un session string que tenés que
// pegar en la variable de entorno TG_SESSION. Esa string reemplaza al
// proceso de login en arranques futuros: con eso solo, el userbot se
// conecta sin volver a pedir código.

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = parseInt(process.env.TG_API_ID || "", 10);
const apiHash = process.env.TG_API_HASH || "";

if (!apiId || !apiHash) {
  console.error("Faltan TG_API_ID o TG_API_HASH en .env");
  console.error("Sacalos de https://my.telegram.org → API development tools");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: () => input.text("Número de teléfono (con +código país): "),
  password: () => input.text("Contraseña 2FA (vacío si no tenés): "),
  phoneCode: () => input.text("Código que llegó por Telegram: "),
  onError: (err) => console.error("Error de login:", err),
});

console.log("\nLogin OK. Esta es tu session string — copiala COMPLETA y pegala");
console.log("en TG_SESSION del .env del servidor. Tratala como una contraseña:\n");
console.log(client.session.save());
console.log("\nGuardada. Cerrando.");

await client.disconnect();
process.exit(0);
