-- =============================================================================
-- Meta Instagram Insights: persistent store for IG Business Account daily
-- metrics + per-media lifetime performance.
--
-- Two tables:
--   meta_ig_account_daily      — daily account-level metrics. Source:
--                                 GET /{ig_id}/insights (reach, follower_count
--                                 via time_series; profile_views,
--                                 accounts_engaged, total_interactions,
--                                 website_clicks, views via total_value per day).
--   meta_ig_media_performance  — per-media lifetime metrics. Source:
--                                 GET /{ig_id}/media + /{media_id}/insights.
--
-- Backfill via scripts/meta-ig-backfill.js
-- Note: in Graph API v22 the `impressions` and `video_views` metrics were
-- removed for media; use `views` and `total_interactions` instead.
-- =============================================================================

CREATE TABLE IF NOT EXISTS meta_ig_account_daily (
  user_id              UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_id                VARCHAR(64)  NOT NULL,
  date                 DATE         NOT NULL,
  reach                INTEGER      NOT NULL DEFAULT 0,
  follower_count_delta INTEGER      NOT NULL DEFAULT 0,
  profile_views        INTEGER      NOT NULL DEFAULT 0,
  accounts_engaged     INTEGER      NOT NULL DEFAULT 0,
  total_interactions   INTEGER      NOT NULL DEFAULT 0,
  website_clicks       INTEGER      NOT NULL DEFAULT 0,
  views                INTEGER      NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ig_id, date)
);

CREATE INDEX IF NOT EXISTS meta_ig_account_daily_date_idx
  ON meta_ig_account_daily (user_id, ig_id, date DESC);

ALTER TABLE meta_ig_account_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_ig_account_daily_select_own ON meta_ig_account_daily
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND NOT (auth.jwt() ->> 'is_anonymous')::boolean IS TRUE);

CREATE POLICY meta_ig_account_daily_service_role ON meta_ig_account_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Per-media performance (lifetime metrics).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_ig_media_performance (
  user_id            UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_id              VARCHAR(64)  NOT NULL,
  media_id           VARCHAR(128) NOT NULL,
  media_type         VARCHAR(32),       -- IMAGE, VIDEO, CAROUSEL_ALBUM, REELS
  media_product_type VARCHAR(32),       -- FEED, REELS, STORY, AD
  caption            TEXT,
  permalink          TEXT,
  timestamp          TIMESTAMPTZ  NOT NULL,
  reach              INTEGER      NOT NULL DEFAULT 0,
  views              INTEGER      NOT NULL DEFAULT 0,
  likes              INTEGER      NOT NULL DEFAULT 0,
  comments           INTEGER      NOT NULL DEFAULT 0,
  shares             INTEGER      NOT NULL DEFAULT 0,
  saved              INTEGER      NOT NULL DEFAULT 0,
  total_interactions INTEGER      NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, media_id)
);

CREATE INDEX IF NOT EXISTS meta_ig_media_performance_account_idx
  ON meta_ig_media_performance (user_id, ig_id, timestamp DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS meta_ig_media_performance_caption_trgm_idx
  ON meta_ig_media_performance USING gin (lower(caption) gin_trgm_ops);

ALTER TABLE meta_ig_media_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_ig_media_performance_select_own ON meta_ig_media_performance
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND NOT (auth.jwt() ->> 'is_anonymous')::boolean IS TRUE);

CREATE POLICY meta_ig_media_performance_service_role ON meta_ig_media_performance
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE meta_ig_account_daily IS
  'Daily account-level Instagram insights. follower_count_delta is the per-day net change in followers (Graph API only exposes deltas, not historical absolute counts).';

COMMENT ON TABLE meta_ig_media_performance IS
  'Per-media lifetime metrics for the IG Business Account. Filter by lower(caption) ILIKE for keyword-based campaign attribution.';
