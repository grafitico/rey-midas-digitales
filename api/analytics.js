// Endpoint de analítica de visitas.
//
// POST /api/analytics  — registra una visita (path + session ID)
// GET  /api/analytics  — devuelve estadísticas: total, hoy, en línea ahora
//
// La tabla page_views debe existir en Supabase. Ejecutar en SQL Editor:
//   CREATE TABLE IF NOT EXISTS public.page_views (
//     id  BIGSERIAL PRIMARY KEY,
//     path TEXT NOT NULL DEFAULT '/',
//     sid  TEXT NOT NULL DEFAULT '',
//     ts   TIMESTAMPTZ NOT NULL DEFAULT NOW()
//   );
//   CREATE INDEX IF NOT EXISTS idx_pv_ts ON public.page_views(ts);
//   ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
//   -- service_role bypasses RLS, así que no necesitamos policy adicional.

import { sb, sbCount, readJson, checkConfig } from "./_lib.js";

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

      // "En línea ahora" = session IDs únicos en los últimos 5 min
      const online = new Set((recentRows || []).map(r => r.sid).filter(Boolean)).size;

      return res.status(200).json({ total, today, online });
    } catch (e) {
      // No exponer detalles del error, pero tampoco romper la UI
      return res.status(200).json({ total: 0, today: 0, online: 0 });
    }
  }

  // POST — registrar visita
  if (req.method === "POST") {
    res.setHeader("Cache-Control", "no-store");
    try {
      const body = await readJson(req);
      await sb("page_views", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          path: String(body.path || "/").slice(0, 200),
          sid:  String(body.sid  || "").slice(0, 64),
        }),
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(200).json({ ok: false });
    }
  }

  return res.status(405).end();
}
