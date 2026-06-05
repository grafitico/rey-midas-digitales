CREATE TABLE IF NOT EXISTS public.page_views (
  id        BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL DEFAULT '/',
  sid       TEXT NOT NULL DEFAULT '',
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_ts ON public.page_views (ts);
CREATE INDEX IF NOT EXISTS idx_pv_sid ON public.page_views (sid);

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
