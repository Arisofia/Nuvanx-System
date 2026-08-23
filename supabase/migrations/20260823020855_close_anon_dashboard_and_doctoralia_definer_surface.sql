-- P0 security hardening: remove unauthenticated dashboard data exposure and
-- prevent untrusted callers from executing the Doctoralia funnel mutator.
--
-- This migration mirrors the emergency production migration applied during the
-- 2026-08-23 forensic audit. Authenticated and service_role access continues to
-- be governed by the existing role-specific RLS policies.
--
-- Some legacy dashboard tables (notably deck_progress) are production-era
-- surfaces that are not guaranteed to exist in a fresh branch. Keep every
-- security-sensitive REVOKE explicit for static validation, but guard each
-- legacy relation so the canonical history is replayable from an empty preview.

DO $$
BEGIN
  IF to_regprocedure('public.refresh_doctoralia_funnel(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)
      TO service_role;
  END IF;

  IF to_regclass('public.deck_progress') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_deck_progress ON public.deck_progress;
    REVOKE ALL PRIVILEGES ON TABLE public.deck_progress FROM anon;
  END IF;

  IF to_regclass('public.doctoralia_appointments_ingestion') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_doctoralia_appointments_ingestion ON public.doctoralia_appointments_ingestion;
    REVOKE ALL PRIVILEGES ON TABLE public.doctoralia_appointments_ingestion FROM anon;
  END IF;

  IF to_regclass('public.meta_attribution') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_attribution ON public.meta_attribution;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_attribution FROM anon;
  END IF;

  IF to_regclass('public.meta_cache') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_cache ON public.meta_cache;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_cache FROM anon;
  END IF;

  IF to_regclass('public.meta_daily_insights') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_daily_insights ON public.meta_daily_insights;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_daily_insights FROM anon;
  END IF;

  IF to_regclass('public.meta_ig_account_daily') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_ig_account_daily ON public.meta_ig_account_daily;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_ig_account_daily FROM anon;
  END IF;

  IF to_regclass('public.meta_ig_media_performance') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_ig_media_performance ON public.meta_ig_media_performance;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_ig_media_performance FROM anon;
  END IF;

  IF to_regclass('public.meta_organic_daily') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_organic_daily ON public.meta_organic_daily;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_organic_daily FROM anon;
  END IF;

  IF to_regclass('public.meta_post_performance') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_meta_post_performance ON public.meta_post_performance;
    REVOKE ALL PRIVILEGES ON TABLE public.meta_post_performance FROM anon;
  END IF;
END $$;
