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
  PERFORM 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('check_stale_meta_tokens', 'rls_auto_enable');

  -- If the functions exist, remove public and anonymous execute permissions.
  EXECUTE $$
    REVOKE EXECUTE ON FUNCTION public.check_stale_meta_tokens() FROM PUBLIC, anon, authenticated;
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  $$;
EXCEPTION WHEN undefined_function THEN
  -- If the function does not exist yet, skip without failing.
  NULL;
END
$$;
