-- =============================================================================
-- Fix security_definer_view lint on vw_doctoralia_lead_traceability_unified.
--
-- This view should execute with the caller's privileges so RLS on underlying
-- tables applies correctly. Use security_invoker = true to enforce that.
-- =============================================================================

ALTER VIEW IF EXISTS public.vw_doctoralia_lead_traceability_unified
  SET (security_invoker = true);
