-- Datos extra del cliente para el panel admin: celular y consola.
-- Correr una sola vez en el SQL editor de Supabase.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS phone   TEXT,
  ADD COLUMN IF NOT EXISTS console TEXT;
