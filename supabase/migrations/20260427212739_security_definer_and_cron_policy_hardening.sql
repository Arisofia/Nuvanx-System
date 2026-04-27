-- =============================================================================
-- Security hardening for Supabase advisor warnings
-- =============================================================================
-- Fixes:
--   - anon/authenticated roles should not be able to execute public SECURITY DEFINER functions
--   - cron.job and cron.job_run_details policies should be scoped to authenticated users only
-- =============================================================================

DO $$
DECLARE
  fn_record RECORD;
BEGIN
  FOR fn_record IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('check_stale_meta_tokens', 'rls_auto_enable')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;',
      fn_record.oid::regprocedure
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  pol RECORD;
  new_roles TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, roles
    FROM pg_policies
    WHERE schemaname = 'cron'
      AND tablename IN ('job', 'job_run_details')
      AND 'anon' = ANY(roles)
  LOOP
    new_roles := array_to_string(array_remove(pol.roles, 'anon'), ', ');
    IF new_roles IS NULL OR new_roles = '' THEN
      new_roles := 'authenticated';
    END IF;
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO %s;', 
      pol.policyname,
      pol.schemaname,
      pol.tablename,
      new_roles
    );
  END LOOP;
END
$$;
