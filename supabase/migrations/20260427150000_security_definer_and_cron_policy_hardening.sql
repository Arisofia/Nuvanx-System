-- =============================================================================
-- Security hardening for Supabase advisor warnings
-- =============================================================================
-- Fixes:
--   - anon/authenticated roles should not be able to execute public SECURITY DEFINER functions
--   - cron.job and cron.job_run_details policies should be scoped to authenticated users only
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_stale_meta_tokens'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_stale_meta_tokens() FROM anon, authenticated;';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;';
  END IF;
END
$$;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE (schemaname = 'cron' AND tablename = 'job')
       OR (schemaname = 'cron' AND tablename = 'job_run_details')
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END
$$;
