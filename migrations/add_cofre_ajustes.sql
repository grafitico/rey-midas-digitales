-- =============================================================
-- Migración: ajustes manuales del Cofre de Oro
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Monedas que el admin suma (+) o quita (−) a mano a un cliente, por
-- ejemplo por una venta que no se registró en la web. Cada ajuste entra en
-- el recorrido del cofre en el orden en que se hizo: después de un canje
-- (que vacía el cofre) sigue sumando normalmente.
-- RLS activado sin políticas: solo el servidor (service_role) la lee.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cofre_ajustes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -50 AND 50),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cofre_ajustes_user ON public.cofre_ajustes (user_id);

ALTER TABLE public.cofre_ajustes ENABLE ROW LEVEL SECURITY;
