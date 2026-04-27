-- =============================================================================
-- Revoke EXECUTE for public SECURITY DEFINER functions from anon/authenticated
-- =============================================================================
-- This migration addresses Supabase security linter warnings for functions
-- that should not be callable by public or signed-in clients.
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
