-- Protección contra fuerza bruta en /api/auth (login).
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run.
-- Si esta migración todavía no corrió, el login sigue funcionando igual
-- (sin límite de intentos) hasta que se aplique — mismo patrón tolerante
-- que las demás migraciones de este proyecto.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
