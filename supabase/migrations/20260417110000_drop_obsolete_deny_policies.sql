-- =============================================================================
-- Drop obsolete deny-all policies superseded by owner-only policies in
-- 20260417100300_rls_with_check.sql
--
-- Migration 20260416120000 added blanket deny policies for authenticated
-- INSERT/UPDATE/DELETE on credentials, leads, and integrations. Migration
-- 20260417100300 replaced those with proper owner-only WITH CHECK policies.
-- The old deny policies are permissive (default), so they don't block the
-- new policies — but they are confusing and should be removed.
-- =============================================================================

-- ─── integrations ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS integrations_no_authenticated_write  ON integrations;
DROP POLICY IF EXISTS integrations_no_authenticated_update ON integrations;
DROP POLICY IF EXISTS integrations_no_authenticated_delete ON integrations;

-- ─── credentials ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS credentials_no_authenticated_write  ON credentials;
DROP POLICY IF EXISTS credentials_no_authenticated_update ON credentials;
DROP POLICY IF EXISTS credentials_no_authenticated_delete ON credentials;

-- ─── leads ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_no_authenticated_write  ON leads;
DROP POLICY IF EXISTS leads_no_authenticated_update ON leads;
DROP POLICY IF EXISTS leads_no_authenticated_delete ON leads;

-- Add DELETE policies so users can remove their own records
DROP POLICY IF EXISTS integrations_delete_own ON integrations;
CREATE POLICY integrations_delete_own ON integrations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS credentials_delete_own ON credentials;
CREATE POLICY credentials_delete_own ON credentials
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS leads_delete_own ON leads;
CREATE POLICY leads_delete_own ON leads
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
