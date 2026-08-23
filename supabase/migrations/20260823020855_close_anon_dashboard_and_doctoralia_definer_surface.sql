-- P0 security hardening: remove unauthenticated dashboard data exposure and
-- prevent untrusted callers from executing the Doctoralia funnel mutator.
--
-- This migration mirrors the emergency production migration applied during the
-- 2026-08-23 forensic audit. Authenticated and service_role access continues to
-- be governed by the existing role-specific RLS policies.

REVOKE EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)
  TO service_role;

DROP POLICY IF EXISTS anon_select_deck_progress
  ON public.deck_progress;
DROP POLICY IF EXISTS anon_select_dashboard_doctoralia_appointments_ingestion
  ON public.doctoralia_appointments_ingestion;
DROP POLICY IF EXISTS anon_select_dashboard_meta_attribution
  ON public.meta_attribution;
DROP POLICY IF EXISTS anon_select_dashboard_meta_cache
  ON public.meta_cache;
DROP POLICY IF EXISTS anon_select_dashboard_meta_daily_insights
  ON public.meta_daily_insights;
DROP POLICY IF EXISTS anon_select_dashboard_meta_ig_account_daily
  ON public.meta_ig_account_daily;
DROP POLICY IF EXISTS anon_select_dashboard_meta_ig_media_performance
  ON public.meta_ig_media_performance;
DROP POLICY IF EXISTS anon_select_dashboard_meta_organic_daily
  ON public.meta_organic_daily;
DROP POLICY IF EXISTS anon_select_dashboard_meta_post_performance
  ON public.meta_post_performance;

REVOKE ALL PRIVILEGES ON TABLE public.deck_progress FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.doctoralia_appointments_ingestion FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_attribution FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_cache FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_daily_insights FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_ig_account_daily FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_ig_media_performance FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_organic_daily FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.meta_post_performance FROM anon;
