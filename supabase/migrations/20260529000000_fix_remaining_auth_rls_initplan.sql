-- 20260529000000_fix_remaining_auth_rls_initplan.sql
--
-- Fixes all remaining Supabase Advisor `auth_rls_initplan` (performance) warnings.
--
-- Root cause: RLS policies were evaluating `auth.uid()`, `auth.jwt()`, `auth.role()`
-- and `current_setting()` per-row instead of once per query (init-plan).
--
-- Solution (per https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select ):
--   - Wrap every auth.*() call as (SELECT auth.<func>())
--   - Wrap the stable helper current_clinic_id() call as (SELECT public.current_clinic_id())
--   - Keep the anonymous-session guard using (SELECT (auth.jwt() ->> 'is_anonymous'))
--
-- This migration:
--   1. Drops the exact policy names reported by the linter (17 policies across 17 tables)
--   2. Recreates them using the wrapped pattern + the existing current_clinic_id() helper
--      (which itself uses the correct (SELECT auth.*()) wrappers internally).
--
-- Tables covered (matching the exact lint output provided):
--   api_call_log, appointments, credentials, doctoralia_patients, doctors,
--   financial_settlements, integrations, patients, treatment_types,
--   clinics, leads, meta_daily_insights, meta_ig_account_daily,
--   meta_ig_media_performance, meta_organic_daily, meta_post_performance,
--   produccion_intermediarios, whatsapp_conversations

BEGIN;

-- NOTE (added during 2026-05-31 cleanup review):
-- This migration was an intermediate step for auth_rls_initplan fixes.
-- current_clinic_id() / current_user_id() consolidated in later RLS migrations.
-- Much of its policy work was later superseded by the more comprehensive
-- 20260530000000_comprehensive_rls_fix.sql.
--
-- This file is kept for historical record but its value is reduced.
-- Consider it a candidate for partial obsolescence.

-- Drop the exact policies reported by the linter (safe IF EXISTS)
DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
DROP POLICY IF EXISTS appointments_select_clinic ON public.appointments;
DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
DROP POLICY IF EXISTS doctors_select_clinic ON public.doctors;
DROP POLICY IF EXISTS financial_settlements_select_clinic ON public.financial_settlements;
DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
DROP POLICY IF EXISTS patients_select_clinic ON public.patients;
DROP POLICY IF EXISTS treatment_types_select_clinic ON public.treatment_types;
DROP POLICY IF EXISTS clinics_select ON public.clinics;
DROP POLICY IF EXISTS leads_select ON public.leads;
DROP POLICY IF EXISTS meta_daily_insights_select ON public.meta_daily_insights;
DROP POLICY IF EXISTS meta_ig_account_daily_select ON public.meta_ig_account_daily;
DROP POLICY IF EXISTS meta_ig_media_performance_select ON public.meta_ig_media_performance;
DROP POLICY IF EXISTS meta_organic_daily_select ON public.meta_organic_daily;
DROP POLICY IF EXISTS meta_post_performance_select ON public.meta_post_performance;
DROP POLICY IF EXISTS produccion_intermediarios_select ON public.produccion_intermediarios;
DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;

-- Recreate with the performance-safe wrapped pattern
-- (SELECT ...) tells the planner these are init-plan expressions (evaluated once)

-- api_call_log: user-owned rows
CREATE POLICY api_call_log_select_own ON public.api_call_log
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND (SELECT auth.uid()) = user_id
  );

-- Clinic-scoped tables (most of the list)
CREATE POLICY appointments_select_clinic ON public.appointments
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY credentials_select_clinic ON public.credentials
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY doctors_select_clinic ON public.doctors
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY financial_settlements_select_clinic ON public.financial_settlements
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY integrations_select_clinic ON public.integrations
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY patients_select_clinic ON public.patients
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY treatment_types_select_clinic ON public.treatment_types
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- clinics (self-owned via current_clinic_id)
CREATE POLICY clinics_select ON public.clinics
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND id = (SELECT public.current_clinic_id())
  );

-- leads
CREATE POLICY leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- Meta insight tables (all clinic-scoped)
CREATE POLICY meta_daily_insights_select ON public.meta_daily_insights
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY meta_ig_account_daily_select ON public.meta_ig_account_daily
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY meta_ig_media_performance_select ON public.meta_ig_media_performance
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY meta_organic_daily_select ON public.meta_organic_daily
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

CREATE POLICY meta_post_performance_select ON public.meta_post_performance
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- produccion_intermediarios
CREATE POLICY produccion_intermediarios_select ON public.produccion_intermediarios
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- whatsapp_conversations
CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- Also harden any lingering service_role policies on the affected tables
-- to use the wrapped pattern (prevents future lint warnings)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'financial_settlements','leads','doctoralia_patients','agent_outputs',
    'meta_daily_insights','meta_ig_account_daily','meta_ig_media_performance',
    'meta_organic_daily','meta_post_performance','produccion_intermediarios'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I_service_role_only ON public.%I',
        t, t
      );
      EXECUTE format(
        'CREATE POLICY %I_service_role_only ON public.%I ' ||
        'USING ((SELECT auth.role()) = ''service_role'') ' ||
        'WITH CHECK ((SELECT auth.role()) = ''service_role'')',
        t, t
      );
    EXCEPTION WHEN OTHERS THEN
      -- Table or privilege issue – safe to continue
      RAISE NOTICE 'Service role policy for % not updated (may not exist or insufficient privs): %', t, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;

-- Verification hint (run after deploying this migration):
--   1. Link once (if not already): npx supabase link --project-ref ssvvuuysgxyqvmovrlvk
--   2. npx supabase db lint --linked --level warning
--   (Alternative with direct URL): npx supabase db lint --db-url "$DATABASE_URL" --level warning
-- All 17 auth_rls_initplan entries from the provided linter output should disappear.