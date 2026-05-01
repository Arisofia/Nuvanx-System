-- =============================================================================
-- Strengthen RLS — WITH CHECK on integrations + credentials
-- =============================================================================

-- integrations: INSERT
DROP POLICY IF EXISTS integrations_insert_own ON integrations;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY integrations_insert_own ON integrations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (clinic_id IS NULL OR clinic_id = (auth.jwt()->>'clinic_id')::uuid)
  );

-- integrations: UPDATE
DROP POLICY IF EXISTS integrations_update_own ON integrations;
CREATE POLICY integrations_update_own ON integrations
  FOR UPDATE TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR (clinic_id IS NULL AND user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (clinic_id IS NULL OR clinic_id = (auth.jwt()->>'clinic_id')::uuid)
  );

-- credentials: INSERT
DROP POLICY IF EXISTS credentials_insert_own ON credentials;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY credentials_insert_own ON credentials
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (clinic_id IS NULL OR clinic_id = (auth.jwt()->>'clinic_id')::uuid)
  );

-- credentials: UPDATE
DROP POLICY IF EXISTS credentials_update_own ON credentials;
CREATE POLICY credentials_update_own ON credentials
  FOR UPDATE TO authenticated
  USING (
    (clinic_id IS NOT NULL AND clinic_id = (auth.jwt()->>'clinic_id')::uuid)
    OR (clinic_id IS NULL AND user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (clinic_id IS NULL OR clinic_id = (auth.jwt()->>'clinic_id')::uuid)
  );
