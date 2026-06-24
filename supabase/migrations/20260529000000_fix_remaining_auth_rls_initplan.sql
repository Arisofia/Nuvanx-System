-- 20260529000000_fix_remaining_auth_rls_initplan.sql
--
-- Historical intermediate auth_rls_initplan remediation. The policy rewrites in
-- this migration are superseded by 20260530000000_comprehensive_rls_fix.sql.
-- Keep this migration as an explicit no-op so preview schemas that do not carry
-- every optional application table do not fail on DROP/CREATE POLICY statements.

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'Skipping superseded auth_rls_initplan policy rewrite; comprehensive RLS fix runs in a later migration.';
END $$;

COMMIT;
