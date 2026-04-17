-- =============================================================================
-- 013: Multi-tenant RLS — add clinic_id to core tables + clinic-scoped policies
-- Requires: 011_clinics.sql (clinics table + users.clinic_id)
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
--    Row visible if the row's clinic_id matches the JWT claim 'clinic_id'.
--    Falls back to user_id match when clinic_id is NULL (single-user mode).
-- ---------------------------------------------------------------------------

-- leads: PII table — SELECT only, no direct browser writes
DROP POLICY IF EXISTS leads_select_clinic ON leads;
CREATE POLICY leads_select_clinic ON leads
  FOR SELECT TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR
    (clinic_id IS NULL AND user_id = auth.uid())
  );

-- integrations: replace old per-user policy with clinic-aware one
DROP POLICY IF EXISTS integrations_select_own ON integrations;
DROP POLICY IF EXISTS integrations_select_clinic ON integrations;
CREATE POLICY integrations_select_clinic ON integrations
  FOR SELECT TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR
    (clinic_id IS NULL AND user_id = auth.uid())
  );

-- credentials: SELECT only, no direct browser access to encrypted keys
DROP POLICY IF EXISTS credentials_select_clinic ON credentials;
CREATE POLICY credentials_select_clinic ON credentials
  FOR SELECT TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR
    (clinic_id IS NULL AND user_id = auth.uid())
  );
