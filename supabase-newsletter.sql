-- =============================================================
-- Migración: tabla de suscriptores de newsletter + códigos de descuento
-- Correr en Supabase → SQL Editor → New query → pegar y Run
-- =============================================================
-- Esta migración es ADITIVA: no borra ni modifica las tablas
-- existentes (app_users, purchases). Solo crea las nuevas.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  source TEXT,  -- 'popup' | 'footer' | 'cart' | 'manual'
  discount_code TEXT,
  discount_used BOOLEAN NOT NULL DEFAULT FALSE,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_newsletter_email ON public.newsletter_subscribers(email);

ALTER TABLE public.newsletter_subscribers DISABLE ROW LEVEL SECURITY;
