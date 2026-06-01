-- =============================================================================
-- meta_daily_insights: persistent store for Meta Ads daily metrics
-- Allows historical queries (since 2025) even after token expiry.
-- Backfill via POST /meta/backfill?days=500 (or equivalent)
-- =============================================================================

-- Clean, final definition of the table (idempotent)
CREATE TABLE IF NOT EXISTS public.meta_daily_insights (
  user_id                 UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id               UUID          REFERENCES public.clinics(id) ON DELETE CASCADE,
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
  actions                 JSONB,
  action_values           JSONB,
  lead_actions            INTEGER GENERATED ALWAYS AS (
    COALESCE((actions->'lead')::int, 0) +
    COALESCE((actions->'onsite_conversion.lead_grouped')::int, 0) +
    COALESCE((actions->'contact_total')::int, 0)
  ) STORED,
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, ad_account_id, date)
);

-- Ensure columns exist if table was created by an older migration
ALTER TABLE public.meta_daily_insights 
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actions JSONB,
  ADD COLUMN IF NOT EXISTS action_values JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- lead_actions (handled separately as it is generated)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meta_daily_insights' AND column_name='lead_actions') THEN
    ALTER TABLE public.meta_daily_insights ADD COLUMN lead_actions INTEGER GENERATED ALWAYS AS (
      COALESCE((actions->'lead')::int, 0) +
      COALESCE((actions->'onsite_conversion.lead_grouped')::int, 0) +
      COALESCE((actions->'contact_total')::int, 0)
    ) STORED;
  END IF;

  COMMENT ON COLUMN public.meta_daily_insights.user_id IS 'Owner of the ad account data (auth.users.id)';
  COMMENT ON COLUMN public.meta_daily_insights.ad_account_id IS 'Meta ad account ID (e.g. 1234567890)';
  COMMENT ON COLUMN public.meta_daily_insights.date IS 'Date of the metrics (daily granularity)';
  COMMENT ON COLUMN public.meta_daily_insights.updated_at IS 'Last time this row was refreshed';
  COMMENT ON COLUMN public.meta_daily_insights.created_at IS 'First time this row was recorded';
END $$;

-- Ensure primary key is correct (swap from user-scoped to clinic-scoped if needed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name='meta_daily_insights' 
    AND constraint_type='PRIMARY KEY'
    AND constraint_name='meta_daily_insights_pkey'
  ) THEN
    -- Check if it is the legacy PK (user_id instead of clinic_id)
    IF EXISTS (
      SELECT 1 FROM information_schema.key_column_usage 
      WHERE table_name='meta_daily_insights' 
      AND constraint_name='meta_daily_insights_pkey' 
      AND column_name='user_id'
    ) THEN
      ALTER TABLE public.meta_daily_insights DROP CONSTRAINT meta_daily_insights_pkey;
      ALTER TABLE public.meta_daily_insights ADD PRIMARY KEY (clinic_id, ad_account_id, date);
    END IF;
  ELSE
    ALTER TABLE public.meta_daily_insights ADD PRIMARY KEY (clinic_id, ad_account_id, date);
  END IF;
END $$;

-- Helpful index for time-based queries
CREATE INDEX IF NOT EXISTS meta_daily_insights_date_idx
  ON public.meta_daily_insights (clinic_id, ad_account_id, date DESC);

-- Enable RLS
ALTER TABLE public.meta_daily_insights ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON public.meta_daily_insights TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_daily_insights TO service_role;

-- RLS Policies (clean and explicit)

-- Authenticated users can only read their own data
DROP POLICY IF EXISTS meta_daily_insights_select_own ON public.meta_daily_insights;
CREATE POLICY meta_daily_insights_select_own
  ON public.meta_daily_insights
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role (Edge Functions, backfills, automation) has full access
DROP POLICY IF EXISTS meta_daily_insights_service_role ON public.meta_daily_insights;
CREATE POLICY meta_daily_insights_service_role
  ON public.meta_daily_insights
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Table documentation
COMMENT ON TABLE public.meta_daily_insights IS
  'Stores daily Meta Ads insights per user/ad_account/date. '
  'Used for historical reporting after token expiry. '
  'RLS: authenticated users see only their own data; service_role has full access. '
  'Finalized definition applied 2026-06-02.';
