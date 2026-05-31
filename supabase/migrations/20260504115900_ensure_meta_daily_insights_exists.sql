-- Ensure the Meta Ads daily insights table exists before any downstream comment,
-- policy, index, or attribution migration references it. This keeps database
-- resets and partially migrated environments idempotent.

CREATE TABLE IF NOT EXISTS public.meta_daily_insights (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(12,4) NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  ctr NUMERIC(8,4) NOT NULL DEFAULT 0,
  cpc NUMERIC(8,4) NOT NULL DEFAULT 0,
  cpm NUMERIC(8,4) NOT NULL DEFAULT 0,
  messaging_conversations INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ad_account_id, date)
);

COMMENT ON TABLE public.meta_daily_insights IS
  'Stores daily Meta Ads insights per user/ad_account/date for historical reporting after token expiry.';
