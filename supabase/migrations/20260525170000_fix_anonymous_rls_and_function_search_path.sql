BEGIN;

-- Fix mutable search_path warning
ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;

-- Helper predicate pattern: authenticated session must not be anonymous.
-- We inline this expression to avoid dependency on helper functions.

-- api_call_log
DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
CREATE POLICY api_call_log_select_own ON public.api_call_log
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND (SELECT auth.uid()) = user_id
  );

-- clinic-scoped tables from advisor output
DROP POLICY IF EXISTS appointments_select_clinic ON public.appointments;
CREATE POLICY appointments_select_clinic ON public.appointments
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
CREATE POLICY credentials_select_clinic ON public.credentials
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS doctors_select_clinic ON public.doctors;
CREATE POLICY doctors_select_clinic ON public.doctors
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS financial_settlements_select_clinic ON public.financial_settlements;
CREATE POLICY financial_settlements_select_clinic ON public.financial_settlements
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
CREATE POLICY integrations_select_clinic ON public.integrations
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS patients_select_clinic ON public.patients;
CREATE POLICY patients_select_clinic ON public.patients
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS treatment_types_select_clinic ON public.treatment_types;
CREATE POLICY treatment_types_select_clinic ON public.treatment_types
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- non-clinic policies listed by advisor
DROP POLICY IF EXISTS clinics_select ON public.clinics;
CREATE POLICY clinics_select ON public.clinics
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS meta_daily_insights_select ON public.meta_daily_insights;
CREATE POLICY meta_daily_insights_select ON public.meta_daily_insights
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS meta_ig_account_daily_select ON public.meta_ig_account_daily;
CREATE POLICY meta_ig_account_daily_select ON public.meta_ig_account_daily
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS meta_ig_media_performance_select ON public.meta_ig_media_performance;
CREATE POLICY meta_ig_media_performance_select ON public.meta_ig_media_performance
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS meta_organic_daily_select ON public.meta_organic_daily;
CREATE POLICY meta_organic_daily_select ON public.meta_organic_daily
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS meta_post_performance_select ON public.meta_post_performance;
CREATE POLICY meta_post_performance_select ON public.meta_post_performance
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS produccion_intermediarios_select ON public.produccion_intermediarios;
CREATE POLICY produccion_intermediarios_select ON public.produccion_intermediarios
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- Hosted cron schema may reject policy DDL depending on ownership.
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS cron_job_policy ON cron.job';
    EXECUTE 'CREATE POLICY cron_job_policy ON cron.job FOR ALL TO service_role USING (true) WITH CHECK (true)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job policy rewrite due to insufficient privilege';
  END;

  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details';
    EXECUTE 'CREATE POLICY cron_job_run_details_policy ON cron.job_run_details FOR SELECT TO service_role USING (true)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job_run_details policy rewrite due to insufficient privilege';
  END;
END $$;

COMMIT;
