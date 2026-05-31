-- =============================================================================
-- meta_daily_insights: persistent store for Meta Ads daily metrics
-- Allows historical queries (since 2025) even after token expiry.
-- Backfill via POST /meta/backfill?days=500
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.meta_daily_insights (
  user_id                 UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id           VARCHAR(32)   NOT NULL,
  date                    DATE          NOT NULL,
  impressions             INTEGER       NOT NULL DEFAULT 0,
  reach                   INTEGER       NOT NULL DEFAULT 0,
  clicks                  INTEGER       NOT NULL DEFAULT 0,
  spend                   NUMERIC(12,4) NOT NULL DEFAULT 0,
  conversions             INTEGER       NOT NULL DEFAULT 0,
  ctr                     NUMERIC(8,4)  NOT NULL DEFAULT 0,
  cpc                     NUMERIC(8,4)  NOT NULL DEFAULT 0,
  cpm                     NUMERIC(8,4)  NOT NULL DEFAULT 0,
  messaging_conversations INTEGER       NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ad_account_id, date)
);

CREATE INDEX IF NOT EXISTS meta_daily_insights_date_idx
  ON public.meta_daily_insights (user_id, ad_account_id, date DESC);

ALTER TABLE public.meta_daily_insights ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.meta_daily_insights TO authenticated;
GRANT ALL ON public.meta_daily_insights TO service_role;

-- Authenticated users can read only their own rows.
DROP POLICY IF EXISTS meta_daily_insights_select_own ON public.meta_daily_insights;

CREATE POLICY meta_daily_insights_select_own
  ON public.meta_daily_insights
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role (Edge Functions and automation) can persist daily metrics.
DROP POLICY IF EXISTS meta_daily_insights_service_role ON public.meta_daily_insights;

CREATE POLICY meta_daily_insights_service_role
  ON public.meta_daily_insights
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
