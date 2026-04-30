-- =============================================================================
-- =============================================================================
-- Ensure SECURITY DEFINER functions are not executable by anon/authenticated.
-- =============================================================================
-- This migration hardens Supabase advisor findings for functions exposed via
-- /rest/v1/rpc/* in the public schema.
--
-- Remediation: revoke EXECUTE from PUBLIC, anon, and authenticated roles for
-- all overloads of the referenced function names.
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
