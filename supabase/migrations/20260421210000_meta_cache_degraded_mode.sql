-- Create meta_cache table for Degraded Mode support
-- Stores the last successful response from Meta Graph API to serve as fallback
CREATE TABLE IF NOT EXISTS public.meta_cache (
  id          TEXT        PRIMARY KEY, -- e.g. 'insights:30d', 'trends'
  user_id     UUID        NOT NULL,
  data        JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.meta_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_cache_select_own ON public.meta_cache
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY meta_cache_upsert_service ON public.meta_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
