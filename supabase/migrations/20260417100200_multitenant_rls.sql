-- =============================================================================
-- Multi-tenant RLS — add clinic_id to core tables + clinic-scoped policies
-- Requires: 20260417100000_clinics.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add clinic_id FK to leads, integrations, credentials
-- ---------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_clinic_id_idx ON leads(clinic_id);

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS integrations_clinic_id_idx ON integrations(clinic_id);

ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS credentials_clinic_id_idx ON credentials(clinic_id);

-- ---------------------------------------------------------------------------
-- 2. Backfill clinic_id from the owning user's clinic_id
-- ---------------------------------------------------------------------------
UPDATE leads        SET clinic_id = u.clinic_id FROM users u WHERE leads.user_id        = u.id AND leads.clinic_id        IS NULL AND u.clinic_id IS NOT NULL;
UPDATE integrations SET clinic_id = u.clinic_id FROM users u WHERE integrations.user_id = u.id AND integrations.clinic_id IS NULL AND u.clinic_id IS NOT NULL;
UPDATE credentials  SET clinic_id = u.clinic_id FROM users u WHERE credentials.user_id  = u.id AND credentials.clinic_id  IS NULL AND u.clinic_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Clinic-scoped RLS policies (authenticated role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leads_select_clinic ON leads;
CREATE POLICY leads_select_clinic ON leads
  FOR SELECT TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR
    (clinic_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS integrations_select_own ON integrations;
DROP POLICY IF EXISTS integrations_select_clinic ON integrations;
CREATE POLICY integrations_select_clinic ON integrations
  FOR SELECT TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR
    (clinic_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS credentials_select_clinic ON credentials;
CREATE POLICY credentials_select_clinic ON credentials
  FOR SELECT TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR
    (clinic_id IS NULL AND user_id = auth.uid())
  );
