-- =============================================================
-- Migración: cuentas (inventario de cuentas de juego)
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Una fila por cuenta comprada (PSN / Xbox / Nintendo), aunque todavía no
-- tenga ventas: así aparece en Ventas → Por cuenta y juego con sus cupos
-- LIBRES. Las ventas siguen en purchases y se unen a la cuenta por el correo.
-- password va cifrada por el servidor (igual que purchases.account_password).
-- tipo: 'auto' = lo decide el catálogo; 'cross' = PS4 y PS5 (5 cupos);
--       'ps5only' = solo PS5 (3 cupos). Solo aplica a PlayStation.
-- RLS activado sin políticas: solo el servidor (service_role) la lee.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cuentas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plataforma TEXT NOT NULL CHECK (plataforma IN ('PlayStation', 'Xbox', 'Nintendo')),
  juego      TEXT NOT NULL,
  correo     TEXT NOT NULL,
  password   TEXT,
  region     TEXT,
  tipo       TEXT NOT NULL DEFAULT 'auto' CHECK (tipo IN ('auto', 'cross', 'ps5only')),
  notas      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un correo = una cuenta (sin importar mayúsculas ni espacios).
CREATE UNIQUE INDEX IF NOT EXISTS cuentas_correo_key ON public.cuentas (lower(trim(correo)));

ALTER TABLE public.cuentas ENABLE ROW LEVEL SECURITY;
