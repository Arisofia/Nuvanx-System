BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.handle_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;
  ELSE
    RAISE NOTICE 'Skipping handle_updated_at search_path hardening because public.handle_updated_at() does not exist';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.has_column(target_table regclass, column_name name)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = target_table
      AND attname = column_name
      AND attnum > 0
      AND NOT attisdropped
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.recreate_select_policy(
  target_table regclass,
  policy_name text,
  predicate_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', policy_name, target_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (%s)',
    policy_name,
    target_table,
    predicate_sql
  );
END;
$$;

DO $$
DECLARE
  target_table regclass;
BEGIN
  target_table := to_regclass('public.api_call_log');
  IF target_table IS NOT NULL AND pg_temp.has_column(target_table, 'user_id') THEN
    PERFORM pg_temp.recreate_select_policy(
      target_table,
      'api_call_log_select_own',
      '(SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND (SELECT auth.uid()) = user_id'
    );
  ELSE
    RAISE NOTICE 'Skipping api_call_log_select_own policy hardening because public.api_call_log or user_id is missing';
  END IF;
END $$;

DO $$
DECLARE
  policy_record record;
  target_table regclass;
BEGIN
  FOR policy_record IN
    SELECT *
    FROM (VALUES
      ('public.appointments', 'appointments_select_clinic'),
      ('public.credentials', 'credentials_select_clinic'),
      ('public.doctoralia_patients', 'doctoralia_patients_select_clinic'),
      ('public.doctors', 'doctors_select_clinic'),
      ('public.financial_settlements', 'financial_settlements_select_clinic'),
      ('public.integrations', 'integrations_select_clinic'),
      ('public.leads', 'leads_select'),
      ('public.meta_daily_insights', 'meta_daily_insights_select'),
      ('public.meta_ig_account_daily', 'meta_ig_account_daily_select'),
      ('public.meta_ig_media_performance', 'meta_ig_media_performance_select'),
      ('public.meta_organic_daily', 'meta_organic_daily_select'),
      ('public.meta_post_performance', 'meta_post_performance_select'),
      ('public.patients', 'patients_select_clinic'),
      ('public.produccion_intermediarios', 'produccion_intermediarios_select'),
      ('public.treatment_types', 'treatment_types_select_clinic'),
      ('public.whatsapp_conversations', 'whatsapp_conversations_select')
    ) AS policies(table_name, policy_name)
  LOOP
    target_table := to_regclass(policy_record.table_name);
    IF target_table IS NOT NULL AND pg_temp.has_column(target_table, 'clinic_id') THEN
      PERFORM pg_temp.recreate_select_policy(
        target_table,
        policy_record.policy_name,
        '(SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT public.current_clinic_id())'
      );
    ELSE
      RAISE NOTICE 'Skipping % policy hardening because % or clinic_id is missing',
        policy_record.policy_name,
        policy_record.table_name;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  target_table regclass;
BEGIN
  target_table := to_regclass('public.clinics');
  IF target_table IS NOT NULL AND pg_temp.has_column(target_table, 'id') THEN
    PERFORM pg_temp.recreate_select_policy(
      target_table,
      'clinics_select',
      '(SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND id = (SELECT public.current_clinic_id())'
    );
  ELSE
    RAISE NOTICE 'Skipping clinics_select policy hardening because public.clinics or id is missing';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    IF to_regclass('cron.job') IS NOT NULL THEN
      EXECUTE 'DROP POLICY IF EXISTS cron_job_policy ON cron.job';
      EXECUTE 'CREATE POLICY cron_job_policy ON cron.job FOR ALL TO service_role USING (true) WITH CHECK (true)';
    ELSE
      RAISE NOTICE 'Skipping cron.job policy rewrite because cron.job does not exist';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job policy rewrite due to insufficient privilege';
  END;

  BEGIN
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details';
      EXECUTE 'CREATE POLICY cron_job_run_details_policy ON cron.job_run_details FOR SELECT TO service_role USING (true)';
    ELSE
      RAISE NOTICE 'Skipping cron.job_run_details policy rewrite because cron.job_run_details does not exist';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job_run_details policy rewrite due to insufficient privilege';
  END;
END $$;

COMMIT;
