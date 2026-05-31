// Endpoint para registrar / inspeccionar / borrar el webhook de Telegram.
// Requiere autenticación de admin (usa el mismo sistema que el resto del API).
//
// Uso:
//   GET  /api/telegram-setup            → muestra info actual (getWebhookInfo)
//   POST /api/telegram-setup            → registra el webhook contra Telegram
//   DELETE /api/telegram-setup          → borra el webhook (deleteWebhook)
//
// El URL del webhook se arma con la variable PUBLIC_BASE_URL (ej:
// https://reymidas.cr) más /api/telegram-webhook. El secret se manda a
// Telegram en el campo `secret_token` y lo validamos en cada update.

import { requireAdmin, handleError } from "./_lib.js";

const TG_API = "https://api.telegram.org";

export default async function handler(req, res) {
  try {
    await requireAdmin(req);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const baseUrl = process.env.PUBLIC_BASE_URL;

    if (!token) throw withStatus("Falta TELEGRAM_BOT_TOKEN", 500);

    if (req.method === "GET") {
      const info = await tg(token, "getWebhookInfo");
      return res.status(200).json({ ok: true, info });
    }

    if (req.method === "POST") {
      if (!secret) throw withStatus("Falta TELEGRAM_WEBHOOK_SECRET", 500);
      if (!baseUrl) throw withStatus("Falta PUBLIC_BASE_URL (ej https://reymidas.cr)", 500);

      const url = `${baseUrl.replace(/\/+$/, "")}/api/telegram-webhook`;
      const result = await tg(token, "setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["channel_post", "edited_channel_post"],
        drop_pending_updates: false,
      });
      return res.status(200).json({ ok: true, url, result });
    }

    if (req.method === "DELETE") {
      const result = await tg(token, "deleteWebhook", { drop_pending_updates: false });
      return res.status(200).json({ ok: true, result });
    }

    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    return handleError(res, e);
  }
}

async function tg(token, method, payload) {
  const r = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = await r.json();
  if (!json.ok) {
    throw withStatus(`Telegram ${method} falló: ${json.description}`, 502);
  }
  return json.result;
}

function withStatus(msg, status) {
  const err = new Error(msg);
  err.status = status;
  return err;
}
