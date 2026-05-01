-- =============================================================================
-- Add DELETE policy on integrations (owner-only)
-- =============================================================================

DROP POLICY IF EXISTS integrations_delete_own ON integrations;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY integrations_delete_own ON integrations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Also add DELETE policy on credentials for consistency
DROP POLICY IF EXISTS credentials_delete_own ON credentials;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY credentials_delete_own ON credentials
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
