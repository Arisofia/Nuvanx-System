-- =============================================================================
-- Fix SECURITY DEFINER regression on get_campaign_roi.
--
-- This migration is now limited to tightening permissions on the function.
-- The canonical function body and dependency on vw_lead_traceability live in
-- 20260518120000_restore_campaign_roi_after_traceability_views.sql.
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.get_campaign_roi(uuid,text,text,text)') IS NULL THEN
    RAISE NOTICE 'Skipping security regression fix: get_campaign_roi(uuid,text,text,text) does not exist yet.';
    RETURN;
  END IF;

  -- Restrict access — service_role only; no public/anon/authenticated.
  REVOKE ALL ON FUNCTION public.get_campaign_roi(uuid,text,text,text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.get_campaign_roi(uuid,text,text,text) FROM anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.get_campaign_roi(uuid,text,text,text) TO service_role;
END $$;
