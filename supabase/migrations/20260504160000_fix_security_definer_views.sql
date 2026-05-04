-- =============================================================================
-- Fix security_definer_view lint on vw_campaign_performance_real and
-- vw_lead_traceability.
--
-- Root cause: both views were created (or last replaced) without the
-- security_invoker option, which means PostgreSQL evaluates them with the
-- permissions of the view owner (postgres/superuser) rather than the calling
-- role, effectively bypassing RLS on the underlying tables.
--
-- Fix: ALTER VIEW ... SET (security_invoker = true) — non-destructive, no
-- column rename, no data loss.  Consistent with the pattern already used in
-- 20260420183532_security_view_invoker_and_function_search_path.sql.
-- =============================================================================

ALTER VIEW IF EXISTS public.vw_campaign_performance_real SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_lead_traceability         SET (security_invoker = true);
