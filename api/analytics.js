// Endpoint de analítica de visitas.
// POST /api/analytics  — registra una visita (page_path + session ID)
// GET  /api/analytics  — devuelve estadísticas: total, hoy, en línea ahora

import { sb, sbCount, readJson, checkConfig, clientIp, createRateLimiter } from "./_lib.js";

// Cualquiera podía mandar visitas falsas sin límite: inflar el contador o
// llenar la tabla page_views. Una persona navegando normal no pasa de unas
// pocas páginas por minuto.
const limit = createRateLimiter({ perMinute: 30, perHour: 300, globalPerHour: 30000 });
const SID_RE = /^[a-z0-9]{8,64}$/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — estadísticas
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    try {
      checkConfig();
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

      const [total, today, recentRows] = await Promise.all([
        sbCount("page_views"),
        sbCount(`page_views?ts=gte.${encodeURIComponent(todayStart)}`),
        sb(`page_views?select=sid&ts=gte.${encodeURIComponent(fiveMinAgo)}&limit=500`),
      ]);

      const online = new Set((recentRows || []).map(r => r.sid).filter(Boolean)).size;
      return res.status(200).json({ total, today, online });
    } catch (e) {
      return res.status(200).json({ total: 0, today: 0, online: 0 });
    }
  }

  // POST — registrar visita
  if (req.method === "POST") {
    res.setHeader("Cache-Control", "no-store");
    try {
      const body = await readJson(req);
      const sid = String(body?.sid || "");
      const path = String(body?.path || "/");
      // Visitas sin sesión válida o con rutas raras no se guardan (no es la web).
      if (!SID_RE.test(sid) || !path.startsWith("/")) return res.status(200).json({ ok: false });
      if (limit(clientIp(req))) return res.status(429).json({ ok: false });
      await sb("page_views", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          page_path: path.slice(0, 200),
          sid,
        }),
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(200).json({ ok: false });
    }
  }

  return res.status(405).end();
}
