-- =============================================================================
-- Fix Supabase advisor findings for get_campaign_roi security:
--   anon_security_definer_function_executable
--   authenticated_security_definer_function_executable
--
-- This migration is now limited to tightening permissions on the function.
-- The canonical function body and dependency on vw_lead_traceability live in
-- the earlier migration that recreates both the view and function together.
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.get_campaign_roi(uuid,text,text,text)') IS NULL THEN
    RAISE NOTICE 'Skipping permission hardening: get_campaign_roi(uuid,text,text,text) does not exist yet.';
    RETURN;
  END IF;

  -- Restrict access — service_role only; no public/anon/authenticated.
  REVOKE ALL ON FUNCTION public.get_campaign_roi(uuid,text,text,text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.get_campaign_roi(uuid,text,text,text) FROM anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.get_campaign_roi(uuid,text,text,text) TO service_role;
END $$;
