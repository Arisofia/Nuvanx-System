-- 20260530000000_comprehensive_rls_fix.sql
--
-- Comprehensive fix for all remaining Supabase Advisor warnings:
-- 1. auth_rls_initplan (Performance): Wrap all auth functions in (SELECT ...)
-- 2. multiple_permissive_policies (Performance): Ensure only one policy per role/action
-- 3. auth_allow_anonymous_sign_ins (Security): Restrict policies to specific roles and add anonymous guards
-- 4. Harden cron table policies

BEGIN;

-- =============================================================================
-- 1. Helper Function Hardening
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_claim_clinic uuid;
  v_user_clinic uuid;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_claim_clinic := ((SELECT auth.jwt()) ->> 'clinic_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_claim_clinic := NULL;
  END;

  IF v_claim_clinic IS NOT NULL THEN
    RETURN v_claim_clinic;
  END IF;

  IF to_regclass('public.users') IS NOT NULL THEN
    SELECT clinic_id INTO v_user_clinic FROM public.users WHERE id = v_user_id LIMIT 1;
    RETURN v_user_clinic;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid());
$$;

-- =============================================================================
-- 2. Clean up and Recreate Policies
-- =============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'api_call_log', 'appointments', 'credentials', 'doctoralia_patients', 
    'doctors', 'financial_settlements', 'integrations', 'patients', 
    'treatment_types', 'clinics', 'leads', 'meta_daily_insights', 
    'meta_ig_account_daily', 'meta_ig_media_performance', 'meta_organic_daily', 
    'meta_post_performance', 'produccion_intermediarios', 'whatsapp_conversations',
    'agent_outputs'
  ];
BEGIN
  -- Drop existing problematic policies first to avoid collisions
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_own ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_authenticated_select ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_only ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service_only ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert_own ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert_service ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read_service ON public.%I', t, t);
  END LOOP;

  -- Recreate policies with strict role scoping and initplan wrappers

  -- 1. api_call_log
  CREATE POLICY api_call_log_select_own ON public.api_call_log
    FOR SELECT TO authenticated
    USING (
      (SELECT auth.uid()) = user_id
      AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
    );

  -- 2. Clinic-scoped tables (SELECT only for authenticated)
  FOREACH t IN ARRAY ARRAY[
    'appointments', 'credentials', 'doctoralia_patients', 'doctors', 
    'financial_settlements', 'integrations', 'patients', 'treatment_types', 
    'leads', 'meta_daily_insights', 'meta_ig_account_daily', 
    'meta_ig_media_performance', 'meta_organic_daily', 'meta_post_performance', 
    'produccion_intermediarios', 'whatsapp_conversations'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I_select_clinic ON public.%I ' ||
      'FOR SELECT TO authenticated ' ||
      'USING (clinic_id = (SELECT public.current_clinic_id()) ' ||
      'AND (SELECT auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'')',
      t, t
    );
  END LOOP;

  -- 3. clinics (self-owned)
  CREATE POLICY clinics_select ON public.clinics
    FOR SELECT TO authenticated
    USING (
      id = (SELECT public.current_clinic_id())
      AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
    );

  -- 4. agent_outputs (Special handling)
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

  -- 5. Service Role policies (Shared pattern, strictly TO service_role)
  FOREACH t IN ARRAY ARRAY[
    'agent_outputs', 'doctoralia_patients', 'financial_settlements', 
    'leads', 'meta_daily_insights', 'meta_ig_account_daily', 
    'meta_ig_media_performance', 'meta_organic_daily', 'meta_post_performance', 
    'produccion_intermediarios'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I_service_role_only ON public.%I ' ||
      'FOR ALL TO service_role ' ||
      'USING ((SELECT auth.role()) = ''service_role'') ' ||
      'WITH CHECK ((SELECT auth.role()) = ''service_role'')',
      t, t
    );
  END LOOP;

END $$;

-- =============================================================================
-- 3. pg_cron Table Hardening
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
