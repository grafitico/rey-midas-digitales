-- Tabla de analítica de visitas para Rey Midas Digitales
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
--
-- El endpoint /api/analytics usa la service_role key que ya está configurada
-- en Vercel, por lo que no requiere configuración adicional.

CREATE TABLE IF NOT EXISTS public.page_views (
  id   BIGSERIAL    PRIMARY KEY,
  path TEXT         NOT NULL DEFAULT '/',
  sid  TEXT         NOT NULL DEFAULT '',
  ts   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_ts  ON public.page_views (ts);
CREATE INDEX IF NOT EXISTS idx_pv_sid ON public.page_views (sid);

-- RLS activado; service_role lo bypasa automáticamente.
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
