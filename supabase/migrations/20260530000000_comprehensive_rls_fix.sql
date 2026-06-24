-- 20260530000000_comprehensive_rls_fix.sql
--
-- Comprehensive fix for remaining Supabase Advisor warnings (policy hardening focus).
--
-- Changes applied in later cleanup:
-- - Removed duplicate re-definition of current_clinic_id() / current_user_id()
--   (consolidated in later RLS migrations).
-- - Simplified the aggressive multi-name policy DROP loop.
--
-- Original goals kept:
-- 1. auth_rls_initplan (Performance)
-- 2. multiple_permissive_policies
-- 3. Role scoping + anonymous guards
-- 4. pg_cron hardening (note: dedicated migration 20260528000000 also exists)

BEGIN;

-- =============================================================================
-- 1. Clean up and Recreate Policies
-- =============================================================================
--
-- Note: Helper functions (current_clinic_id / current_user_id) were consolidated
-- in later RLS migrations.
-- This migration focuses on policy hardening only.
-- =============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'api_call_log', 'appointments', 'credentials', 'doctoralia_patients', 
    'doctors', 'financial_settlements', 'integrations', 'patients', 
    'treatment_types', 'clinics', 'leads', 'meta_daily_insights', 
    'meta_ig_account_daily', 'meta_ig_media_performance', 'meta_organic_daily', 
    'meta_post_performance', 'produccion_intermediarios', 'whatsapp_conversations'
  ];
BEGIN
  -- Drop the most common policy names we created in earlier migrations.
  -- (Simplified from the original very broad cleanup to reduce noise.)
  FOREACH t IN ARRAY tables
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping policy cleanup for public.%: table does not exist yet', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_own ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_only ON public.%I', t, t);
  END LOOP;

  -- Recreate policies with strict role scoping and initplan wrappers

  -- 1. api_call_log
  IF to_regclass('public.api_call_log') IS NOT NULL THEN
    CREATE POLICY api_call_log_select_own ON public.api_call_log
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.uid()) = user_id
        AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
      );
  END IF;

  -- 2. Clinic-scoped tables (SELECT only for authenticated)
  FOREACH t IN ARRAY ARRAY[
    'appointments', 'credentials', 'doctoralia_patients', 'doctors', 
    'financial_settlements', 'integrations', 'patients', 'treatment_types', 
    'leads', 'meta_daily_insights', 'meta_ig_account_daily', 
    'meta_ig_media_performance', 'meta_organic_daily', 'meta_post_performance', 
    'produccion_intermediarios', 'whatsapp_conversations'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping clinic-scoped policy for public.%: table does not exist yet', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE POLICY %I_select_clinic ON public.%I ' ||
      'FOR SELECT TO authenticated ' ||
      'USING (clinic_id = (SELECT public.current_clinic_id()) ' ||
      'AND (SELECT auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'')',
      t, t
    );
  END LOOP;

  -- 3. clinics (self-owned)
  IF to_regclass('public.clinics') IS NOT NULL THEN
    CREATE POLICY clinics_select ON public.clinics
      FOR SELECT TO authenticated
      USING (
        id = (SELECT public.current_clinic_id())
        AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
      );
  END IF;

  -- 4. agent_outputs (Special handling)
  IF to_regclass('public.agent_outputs') IS NOT NULL THEN
    DROP POLICY IF EXISTS agent_outputs_select_clinic ON public.agent_outputs;
    DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;

    CREATE POLICY agent_outputs_select_clinic ON public.agent_outputs
      FOR SELECT TO authenticated
      USING (
        clinic_id = (SELECT public.current_clinic_id())
        AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
      );

    CREATE POLICY agent_outputs_insert_own ON public.agent_outputs
      FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
      );
  END IF;

  -- 5. Service Role policies (Shared pattern, strictly TO service_role)
  FOREACH t IN ARRAY ARRAY[
    'agent_outputs', 'doctoralia_patients', 'financial_settlements', 
    'leads', 'meta_daily_insights', 'meta_ig_account_daily', 
    'meta_ig_media_performance', 'meta_organic_daily', 'meta_post_performance', 
    'produccion_intermediarios'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I_service_role_only ON public.%I',
        t, t
      );
      EXECUTE format(
        'CREATE POLICY %I_service_role_only ON public.%I ' ||
        'FOR ALL TO service_role ' ||
        'USING ((SELECT auth.role()) = ''service_role'') ' ||
        'WITH CHECK ((SELECT auth.role()) = ''service_role'')',
        t, t
      );
    END IF;
  END LOOP;

END $$;

-- =============================================================================
-- 2. pg_cron Table Hardening
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS cron_job_policy ON cron.job;
      DROP POLICY IF EXISTS cron_job_authenticated_select ON cron.job;
      DROP POLICY IF EXISTS cron_job_service_role_only ON cron.job;
      
      CREATE POLICY cron_job_service_role_only ON cron.job
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping cron.job policy remediation due to insufficient privilege';
    END;
  END IF;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details;
      DROP POLICY IF EXISTS cron_job_run_details_authenticated_select ON cron.job_run_details;
      DROP POLICY IF EXISTS cron_job_run_details_service_role_only ON cron.job_run_details;

      CREATE POLICY cron_job_run_details_service_role_only ON cron.job_run_details
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping cron.job_run_details policy remediation due to insufficient privilege';
    END;
  END IF;
END $$;

COMMIT;
