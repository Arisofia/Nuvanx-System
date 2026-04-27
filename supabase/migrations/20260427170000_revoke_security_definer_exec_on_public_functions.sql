-- =============================================================================
-- Revoke EXECUTE for public SECURITY DEFINER functions from anon/authenticated
-- =============================================================================
-- This migration addresses Supabase security linter warnings for functions
-- that should not be callable by public or signed-in clients.
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
