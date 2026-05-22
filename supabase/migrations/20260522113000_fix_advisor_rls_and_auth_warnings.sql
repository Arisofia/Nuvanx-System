BEGIN;

-- 1) Security advisor: remove anonymous/public access policies on cron metadata tables.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS cron_job_policy ON cron.job;
      CREATE POLICY cron_job_authenticated_select
        ON cron.job
        FOR SELECT
        TO authenticated
        USING (true);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping cron.job policy remediation due to insufficient privilege';
    END;
  END IF;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    BEGIN
      DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details;
      CREATE POLICY cron_job_run_details_authenticated_select
        ON cron.job_run_details
        FOR SELECT
        TO authenticated
        USING (true);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping cron.job_run_details policy remediation due to insufficient privilege';
    END;
  END IF;
END $$;

-- 2) Performance advisor: recreate policies to avoid per-row auth.<fn>() evaluation.
DO $$
BEGIN
  IF to_regclass('public.integrations') IS NOT NULL THEN
    DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
    CREATE POLICY integrations_select_clinic ON public.integrations
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.credentials') IS NOT NULL THEN
    DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
    CREATE POLICY credentials_select_clinic ON public.credentials
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.api_call_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
    CREATE POLICY api_call_log_select_own ON public.api_call_log
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
  END IF;

  IF to_regclass('public.patients') IS NOT NULL THEN
    DROP POLICY IF EXISTS patients_select_clinic ON public.patients;
    CREATE POLICY patients_select_clinic ON public.patients
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.doctors') IS NOT NULL THEN
    DROP POLICY IF EXISTS doctors_select_clinic ON public.doctors;
    CREATE POLICY doctors_select_clinic ON public.doctors
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.treatment_types') IS NOT NULL THEN
    DROP POLICY IF EXISTS treatment_types_select_clinic ON public.treatment_types;
    CREATE POLICY treatment_types_select_clinic ON public.treatment_types
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.appointments') IS NOT NULL THEN
    DROP POLICY IF EXISTS appointments_select_clinic ON public.appointments;
    CREATE POLICY appointments_select_clinic ON public.appointments
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.financial_settlements') IS NOT NULL THEN
    DROP POLICY IF EXISTS financial_settlements_select_clinic ON public.financial_settlements;
    CREATE POLICY financial_settlements_select_clinic ON public.financial_settlements
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.doctoralia_patients') IS NOT NULL THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    DROP POLICY IF EXISTS produccion_intermediarios_authenticated_select ON public.produccion_intermediarios;
    CREATE POLICY produccion_intermediarios_authenticated_select ON public.produccion_intermediarios
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL);
  END IF;

  IF to_regclass('public.clinics') IS NOT NULL THEN
    DROP POLICY IF EXISTS clinics_select_own ON public.clinics;
    CREATE POLICY clinics_select_own ON public.clinics
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.leads') IS NOT NULL THEN
    DROP POLICY IF EXISTS leads_select_authenticated_or_clinic ON public.leads;
    CREATE POLICY leads_select_authenticated_or_clinic ON public.leads
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;

  IF to_regclass('public.whatsapp_conversations') IS NOT NULL THEN
    DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON public.whatsapp_conversations;
    CREATE POLICY whatsapp_conversations_select_clinic ON public.whatsapp_conversations
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));
  END IF;
END $$;

COMMIT;
