-- =============================================================================
-- Drop obsolete deny-all policies superseded by owner-only policies in
-- 014_rls_with_check.sql
-- =============================================================================

DROP POLICY IF EXISTS integrations_no_authenticated_write  ON integrations;
DROP POLICY IF EXISTS integrations_no_authenticated_update ON integrations;
DROP POLICY IF EXISTS integrations_no_authenticated_delete ON integrations;

DROP POLICY IF EXISTS credentials_no_authenticated_write  ON credentials;
DROP POLICY IF EXISTS credentials_no_authenticated_update ON credentials;
DROP POLICY IF EXISTS credentials_no_authenticated_delete ON credentials;

DROP POLICY IF EXISTS leads_no_authenticated_write  ON leads;
DROP POLICY IF EXISTS leads_no_authenticated_update ON leads;
DROP POLICY IF EXISTS leads_no_authenticated_delete ON leads;

-- Owner-only DELETE policies
CREATE POLICY IF NOT EXISTS integrations_delete_own ON integrations
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY IF NOT EXISTS credentials_delete_own ON credentials
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY IF NOT EXISTS leads_delete_own ON leads
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
