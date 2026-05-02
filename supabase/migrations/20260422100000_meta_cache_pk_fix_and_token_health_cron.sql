-- =============================================================================
-- Meta Cache: fix primary key + pg_cron daily token health alert
-- =============================================================================
-- Problem: meta_cache had id TEXT PRIMARY KEY which means different users
-- sharing a cache key (e.g. 'meta:insights:30') would overwrite each other.
-- Fix: recreate with composite PK (user_id, id).
-- =============================================================================

-- Recreate meta_cache with correct composite PK
DROP TABLE IF EXISTS public.meta_cache;

CREATE TABLE public.meta_cache (
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id          TEXT        NOT NULL,  -- cache key e.g. 'meta:insights:30', 'dashboard:meta-trends'
  data        JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX meta_cache_updated_at_idx ON public.meta_cache (user_id, updated_at DESC);

ALTER TABLE public.meta_cache ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own cache
CREATE POLICY meta_cache_select_own ON public.meta_cache
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Service role can write (Edge Function uses service role key)
CREATE POLICY meta_cache_service_role ON public.meta_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- pg_cron: daily Meta token health check at 08:00 Madrid time (UTC+2 in summer)
-- Checks for integrations whose last_sync is over 50 days ago (token expires at 60d)
-- and inserts a warning into monitoring.operational_events.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_stale_meta_tokens()
RETURNS void
LANGUAGE plpgsql
-- SECURITY DEFINER found here; review manually before changing to SECURITY INVOKER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  warning_threshold INTERVAL := INTERVAL '50 days';
BEGIN
  FOR r IN
    SELECT i.user_id, i.last_sync, i.status, i.metadata
    FROM public.integrations i
    WHERE i.service = 'meta'
      AND i.status = 'connected'
      AND (
        i.last_sync IS NULL
        OR i.last_sync < (NOW() - warning_threshold)
      )
  LOOP
    INSERT INTO monitoring.operational_events (
      user_id,
      event_type,
      message,
      metadata
    ) VALUES (
      r.user_id,
      'meta_token_expiry_warning',
      'Meta access token may expire soon. Last verified: ' ||
        COALESCE(r.last_sync::text, 'never') ||
        '. Re-connect Meta in the Integration Center before the token expires.',
      jsonb_build_object(
        'last_sync',        r.last_sync,
        'threshold_days',   50,
        'action_required',  'Re-connect Meta in the Integration Center',
        'doc_url',          'https://developers.facebook.com/docs/facebook-login/access-tokens/refreshing'
      )
    );
  END LOOP;
END;
$$;

-- Register daily cron (06:00 UTC = 08:00 Madrid in CEST)
-- Requires pg_cron extension. If the extension is not enabled, this block
-- is skipped gracefully so the rest of the migration still applies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'meta-token-health-daily',
      '0 6 * * *',
      $cron$ SELECT public.check_stale_meta_tokens() $cron$
    );
  END IF;
END
$$;
