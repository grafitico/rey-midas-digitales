-- =============================================================
-- Migración: Ranking de embajadores (invitar y compartir)
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Cada cliente invita con su código RM (o su enlace ?r=RM0083). Suma puntos
-- cuando una persona nueva abre su enlace (+1, con tope diario), cuando un
-- invitado se registra (+10) y cuando un invitado compra (+50). El ranking es
-- por mes (columna mes = 'AAAA-MM') y arranca de cero cada mes.
-- visitante: huella anónima (sha256 de IP + dispositivo); no guarda la IP.
-- anulado: el admin puede anular puntos sospechosos (no se borran).
-- =============================================================

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS referido_por UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.ranking_eventos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_user_id  UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('visita', 'registro', 'compra')),
  puntos       INTEGER NOT NULL,
  mes          TEXT NOT NULL,
  visitante    TEXT,
  user_id      UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  purchase_id  UUID,
  ruta         TEXT,
  anulado      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ranking_eventos_mes ON public.ranking_eventos (mes, ref_user_id);
CREATE INDEX IF NOT EXISTS ranking_eventos_visita ON public.ranking_eventos (ref_user_id, visitante, created_at);
-- Un registro y una compra cuentan una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS ranking_registro_unico ON public.ranking_eventos (user_id) WHERE tipo = 'registro';
CREATE UNIQUE INDEX IF NOT EXISTS ranking_compra_unica ON public.ranking_eventos (purchase_id) WHERE tipo = 'compra';

-- Solo la API (clave de servicio) lee y escribe esta tabla.
ALTER TABLE public.ranking_eventos ENABLE ROW LEVEL SECURITY;
