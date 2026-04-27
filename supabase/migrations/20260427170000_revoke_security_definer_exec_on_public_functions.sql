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
  -- revoke execute on all overloads of public.check_stale_meta_tokens
  FOR fn_record IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_stale_meta_tokens'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated;',
      fn_record.oid::regprocedure
    );
  END LOOP;

  -- revoke execute on all overloads of public.rls_auto_enable
  FOR fn_record IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rls_auto_enable'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated;',
      fn_record.oid::regprocedure
    );
  END LOOP;
END
$$;
