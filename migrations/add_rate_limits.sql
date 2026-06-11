-- =============================================================
-- Rate limiting persistente para endpoints sensibles (login, newsletter).
-- Correr en: Supabase Dashboard → SQL Editor → New query → pegar todo → Run
-- =============================================================
-- La API llama a la función check_rate_limit() vía RPC. La función registra
-- el intento de forma atómica y devuelve TRUE si el cliente sigue dentro del
-- límite, o FALSE si lo superó dentro de la ventana de tiempo.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Toda la autorización pasa por la API con la service_role key (igual que el
-- resto del esquema), así que RLS queda desactivado a propósito.
ALTER TABLE public.rate_limits DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key        TEXT,
  p_limit      INTEGER,
  p_window_sec INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.rate_limits AS rl (key, count, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE
    SET
      -- Si la ventana venció, reiniciamos el contador a 1; si no, sumamos.
      count = CASE
        WHEN rl.window_start < NOW() - make_interval(secs => p_window_sec)
          THEN 1
          ELSE rl.count + 1
      END,
      window_start = CASE
        WHEN rl.window_start < NOW() - make_interval(secs => p_window_sec)
          THEN NOW()
          ELSE rl.window_start
      END
  RETURNING rl.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- Limpieza opcional de filas viejas (correr de vez en cuando o con un cron):
-- DELETE FROM public.rate_limits WHERE window_start < NOW() - INTERVAL '1 day';
