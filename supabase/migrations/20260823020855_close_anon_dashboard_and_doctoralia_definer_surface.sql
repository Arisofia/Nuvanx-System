-- P0 security hardening: remove unauthenticated dashboard data exposure and
-- prevent untrusted callers from executing the Doctoralia funnel mutator.
--
-- This migration mirrors the emergency production migration applied during the
-- 2026-08-23 forensic audit. Authenticated and service_role access continues to
-- be governed by the existing role-specific RLS policies.
--
-- Some legacy dashboard tables (notably deck_progress) are production-era
-- surfaces that are not guaranteed to exist in a fresh branch. Apply the same
-- fail-closed hardening conditionally so the canonical migration history is
-- replayable from an empty preview database.

DO $$
DECLARE
  v_table text;
  v_policy text;
BEGIN
  IF to_regprocedure('public.refresh_doctoralia_funnel(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)
      TO service_role;
  END IF;

  FOR v_table, v_policy IN
    SELECT * FROM (VALUES
      ('deck_progress', 'anon_select_deck_progress'),
      ('doctoralia_appointments_ingestion', 'anon_select_dashboard_doctoralia_appointments_ingestion'),
      ('meta_attribution', 'anon_select_dashboard_meta_attribution'),
      ('meta_cache', 'anon_select_dashboard_meta_cache'),
      ('meta_daily_insights', 'anon_select_dashboard_meta_daily_insights'),
      ('meta_ig_account_daily', 'anon_select_dashboard_meta_ig_account_daily'),
      ('meta_ig_media_performance', 'anon_select_dashboard_meta_ig_media_performance'),
      ('meta_organic_daily', 'anon_select_dashboard_meta_organic_daily'),
      ('meta_post_performance', 'anon_select_dashboard_meta_post_performance')
    ) AS hardening(table_name, policy_name)
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, v_table);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', v_table);
    END IF;
  END LOOP;
END $$;
