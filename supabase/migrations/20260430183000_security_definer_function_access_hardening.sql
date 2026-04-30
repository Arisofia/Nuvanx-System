-- =============================================================================
-- Ensure SECURITY DEFINER functions are not executable by anon/authenticated.
-- =============================================================================
-- This migration hardens Supabase advisor findings for functions exposed via
-- /rest/v1/rpc/* in the public schema.
--
-- Remediation: revoke EXECUTE from PUBLIC, anon, and authenticated roles.
-- =============================================================================

DO $$
BEGIN
  -- If the functions exist, remove public and anonymous execute permissions.
  -- check_stale_meta_tokens
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'check_stale_meta_tokens') THEN
    REVOKE EXECUTE ON FUNCTION public.check_stale_meta_tokens() FROM PUBLIC, anon, authenticated;
  END IF;

  -- rls_auto_enable
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable') THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
