-- Migration 006: Lock down dashboard_metrics and rename figma_tokens
-- Applied: 2026-04-16

-- ─── dashboard_metrics: remove stale permissive anon read policy ─────────────
DROP POLICY IF EXISTS "anon_read_dashboard_metrics" ON dashboard_metrics;
DROP POLICY IF EXISTS "Allow anon read" ON dashboard_metrics;
DROP POLICY IF EXISTS "Enable read access for all users" ON dashboard_metrics;

-- dashboard_metrics is written by backend service role only.
-- Authenticated users can read their own row.
ALTER TABLE dashboard_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_metrics_owner_select"
  ON dashboard_metrics FOR SELECT
  USING (auth.uid() = user_id);

-- ─── Rename figma_tokens to design_tokens ────────────────────────────────────
ALTER TABLE IF EXISTS figma_tokens RENAME TO design_tokens;
