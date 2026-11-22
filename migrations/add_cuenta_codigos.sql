-- =============================================================
-- Migración: bóveda de códigos de verificación por cuenta
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Todos los códigos de verificación (2FA) de una cuenta se guardan una sola
-- vez en la cuenta, cifrados (aes-256-gcm con ACCOUNT_SECRET, como las
-- contraseñas). Solo el admin los ve. Cada venta recibe 2 códigos libres y el
-- cliente ve únicamente esos; cada código queda marcado como libre,
-- entregado (a qué venta y cuándo), expuesto (un cliente lo vio antes de la
-- bóveda) o anulado (Sony lo invalidó al generar un set nuevo).
-- La columna guarda un JSON cifrado: no se puede leer desde Supabase.
-- =============================================================

ALTER TABLE public.cuentas
  ADD COLUMN IF NOT EXISTS codigos TEXT;
