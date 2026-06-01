-- =============================================================
-- Esquema para Rey Midas Digitales — Custom Auth
-- Correrlo en: Supabase Dashboard → SQL Editor → New query → pegar todo → Run
-- =============================================================
-- Esta versión NO usa Supabase Auth. Toda la autenticación corre
-- en nuestros propios endpoints (api/auth.js, api/clients.js,
-- api/purchases.js) usando la service_role key.
-- =============================================================

-- Limpieza de versiones anteriores
DROP TABLE IF EXISTS public.purchases CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

-- =============================================================
-- 1. Tabla de usuarios de la app
-- =============================================================
CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  customer_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE SEQUENCE IF NOT EXISTS app_users_customer_number_seq START 1;
ALTER TABLE public.app_users ALTER COLUMN customer_number SET DEFAULT nextval('app_users_customer_number_seq');
CREATE INDEX idx_app_users_email ON public.app_users(email);

-- =============================================================
-- 2. Tabla de compras
-- =============================================================
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  platform TEXT NOT NULL,
  modality TEXT,
  account_email TEXT NOT NULL,
  account_password TEXT NOT NULL,
  verifier_codes TEXT,
  games TEXT,
  game_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_purchases_user_id ON public.purchases(user_id);
CREATE INDEX idx_purchases_date ON public.purchases(purchase_date DESC);

-- =============================================================
-- Migraciones incrementales (si las tablas ya existen, correr solo esto):
-- ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS game_name TEXT;
--
-- ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS customer_number INTEGER;
-- CREATE SEQUENCE IF NOT EXISTS app_users_customer_number_seq;
-- ALTER TABLE public.app_users ALTER COLUMN customer_number SET DEFAULT nextval('app_users_customer_number_seq');
-- WITH ranked AS (
--   SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
--   FROM public.app_users WHERE customer_number IS NULL
-- )
-- UPDATE public.app_users a SET customer_number = r.rn FROM ranked r WHERE a.id = r.id;
-- SELECT setval('app_users_customer_number_seq', COALESCE((SELECT MAX(customer_number) FROM public.app_users), 0) + 1, false);
-- =============================================================

-- =============================================================
-- 3. RLS desactivado a propósito
-- =============================================================
-- Toda la autorización se hace en la API server-side con la
-- service_role key. La API valida el token de sesión y el flag
-- is_admin antes de dejar pasar cualquier consulta.
-- =============================================================
ALTER TABLE public.app_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases DISABLE ROW LEVEL SECURITY;
