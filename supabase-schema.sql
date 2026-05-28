-- =============================================================
-- Esquema de base de datos para Rey Midas Digitales
-- Correrlo en: Supabase Dashboard → SQL Editor → New query → pegar todo → Run
-- =============================================================

-- =============================================================
-- 1. Tabla de perfiles (extiende auth.users con datos propios)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- 2. Tabla de compras
-- =============================================================
CREATE TABLE IF NOT EXISTS public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  platform TEXT NOT NULL,             -- 'PS5' | 'PS4' | 'PS3' | 'Xbox' | 'Switch'
  modality TEXT,                      -- 'principal' | 'secundaria' | 'bundle' | 'individual'
  account_email TEXT NOT NULL,
  account_password TEXT NOT NULL,
  verifier_codes TEXT,                -- códigos del 2FA / backup codes
  games TEXT,                         -- lista libre, un juego por línea
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchases_user_id_idx ON public.purchases(user_id);
CREATE INDEX IF NOT EXISTS purchases_date_idx ON public.purchases(purchase_date DESC);

-- =============================================================
-- 3. Trigger: crear perfil automáticamente al registrar usuario
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- 4. Trigger: updated_at automático en purchases
-- =============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS purchases_updated_at ON public.purchases;
CREATE TRIGGER purchases_updated_at
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================
-- 5. RLS (Row Level Security) — quién puede ver qué
-- =============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

-- Cada usuario ve solo su perfil
DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Admins pueden leer/editar todos los perfiles
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE)
  );

-- Cada usuario ve solo sus compras
DROP POLICY IF EXISTS "purchases_self_read" ON public.purchases;
CREATE POLICY "purchases_self_read" ON public.purchases
  FOR SELECT USING (auth.uid() = user_id);

-- Admins hacen todo con compras
DROP POLICY IF EXISTS "purchases_admin_all" ON public.purchases;
CREATE POLICY "purchases_admin_all" ON public.purchases
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE)
  );

-- =============================================================
-- 6. BOOTSTRAP DE ADMIN
-- =============================================================
-- Después de tu PRIMER login en la web (que crea tu fila en profiles),
-- volvé a Supabase → SQL Editor y corré esto reemplazando el email:
--
--   UPDATE public.profiles SET is_admin = TRUE
--   WHERE email = 'grafiticopublicidad@gmail.com';
--
-- A partir de ahí tu cuenta puede entrar al panel /admin del sitio.
