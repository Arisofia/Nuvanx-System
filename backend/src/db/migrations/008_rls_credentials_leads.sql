-- Migration 005: Enable RLS on credentials and leads tables (GDPR compliance)
-- Applied: 2026-04-16

-- ─── credentials ─────────────────────────────────────────────────────────────
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;

-- Users can only access their own credentials
CREATE POLICY "credentials_owner_select"
  ON credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "credentials_owner_insert"
  ON credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "credentials_owner_update"
  ON credentials FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "credentials_owner_delete"
  ON credentials FOR DELETE
  USING (auth.uid() = user_id);

-- ─── leads ───────────────────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Users can only access leads they own
CREATE POLICY "leads_owner_select"
  ON leads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "leads_owner_insert"
  ON leads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "leads_owner_update"
  ON leads FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "leads_owner_delete"
  ON leads FOR DELETE
  USING (auth.uid() = user_id);
