-- =============================================================================
-- Meta Organic Insights: persistent store for Page-level + Post-level
-- (organic) performance. Mirrors the meta_daily_insights pattern but for
-- the Page Insights / Page Posts endpoints.
--
-- Two tables:
--   meta_organic_daily      — daily totals per page (impressions, reach,
--                              engagements, video views, page views,
--                              reactions). Source: GET /{page_id}/insights
--   meta_post_performance   — per-post lifetime metrics. Source:
--                              GET /{page_id}/posts?fields=...,insights.metric(...)
--
-- Backfill via scripts/meta-organic-backfill.js
-- =============================================================================

CREATE TABLE IF NOT EXISTS meta_organic_daily (
  user_id        UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id        VARCHAR(64)  NOT NULL,
  date           DATE         NOT NULL,
  impressions    INTEGER      NOT NULL DEFAULT 0,
  reach          INTEGER      NOT NULL DEFAULT 0,
  engagements    INTEGER      NOT NULL DEFAULT 0,
  video_views    INTEGER      NOT NULL DEFAULT 0,
  page_views     INTEGER      NOT NULL DEFAULT 0,
  reactions      INTEGER      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, page_id, date)
);

CREATE INDEX IF NOT EXISTS meta_organic_daily_date_idx
  ON meta_organic_daily (user_id, page_id, date DESC);

ALTER TABLE meta_organic_daily ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_organic_daily'
      AND policyname = 'meta_organic_daily_select_own'
  ) THEN
    CREATE POLICY meta_organic_daily_select_own ON public.meta_organic_daily
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id AND NOT (auth.jwt() ->> 'is_anonymous')::boolean IS TRUE);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_organic_daily'
      AND policyname = 'meta_organic_daily_service_role'
  ) THEN
    CREATE POLICY meta_organic_daily_service_role ON public.meta_organic_daily
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Per-post performance (organic posts on the timeline only; ads-only dark
-- posts are not returned by /{page_id}/posts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_post_performance (
  user_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id          VARCHAR(64)  NOT NULL,
  post_id          VARCHAR(128) NOT NULL,
  created_time     TIMESTAMPTZ  NOT NULL,
  message          TEXT,
  status_type      VARCHAR(64),     -- e.g. added_video, added_photos, mobile_status_update
  permalink_url    TEXT,
  impressions      INTEGER      NOT NULL DEFAULT 0,
  reach            INTEGER      NOT NULL DEFAULT 0,
  engaged_users    INTEGER      NOT NULL DEFAULT 0,
  reactions        INTEGER      NOT NULL DEFAULT 0,
  comments         INTEGER      NOT NULL DEFAULT 0,
  shares           INTEGER      NOT NULL DEFAULT 0,
  video_views      INTEGER      NOT NULL DEFAULT 0,
  is_video         BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS meta_post_performance_page_idx
  ON meta_post_performance (user_id, page_id, created_time DESC);

-- Trigram index over message for keyword search (e.g. 'co2', 'botox', 'endolift').
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS meta_post_performance_message_trgm_idx
  ON meta_post_performance USING gin (lower(message) gin_trgm_ops);

ALTER TABLE meta_post_performance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_post_performance'
      AND policyname = 'meta_post_performance_select_own'
  ) THEN
    CREATE POLICY meta_post_performance_select_own ON public.meta_post_performance
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id AND NOT (auth.jwt() ->> 'is_anonymous')::boolean IS TRUE);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_post_performance'
      AND policyname = 'meta_post_performance_service_role'
  ) THEN
    CREATE POLICY meta_post_performance_service_role ON public.meta_post_performance
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE meta_organic_daily IS
  'Daily totals from Meta Page Insights API (organic + paid mixed at page level — Meta deprecated organic-only page metrics in v22). Use meta_post_performance for true organic content attribution.';

COMMENT ON TABLE meta_post_performance IS
  'Per-post lifetime metrics for organic page posts. Backfilled via /{page_id}/posts. Filter by lower(message) ILIKE for keyword-based campaign attribution.';
