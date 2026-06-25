-- Resolve Supabase database-linter security warnings reported on 2026-06-25.
-- This migration is catalog-driven so it remains safe across production,
-- preview, and freshly rebuilt databases with partial operational artifacts.

DO $$
DECLARE
  target regclass;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    to_regclass('public._doctoralia_backfill_20260620'),
    to_regclass('public.doctoralia_appointments_ingestion_backup_20260620')
  ]
  LOOP
    IF target IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
      EXECUTE format('DROP POLICY IF EXISTS linter_service_role_maintenance_all ON %s', target);
      EXECUTE format(
        'CREATE POLICY linter_service_role_maintenance_all ON %s FOR ALL TO service_role USING (true) WITH CHECK (true)',
        target
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'v_new_clients_by_channel_detail',
    'vw_doctoralia_lead_traceability_unified',
    'v_figma_meta_signal_health',
    'vw_doctoralia_trazabilidad_360',
    'vw_campaign_performance_real',
    'doctoralia_appointments'
  ]
  LOOP
    IF to_regclass(format('public.%I', view_name)) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', view_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'nvx_csv_split'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', fn.signature);
  END LOOP;
END $$;

DO $$
DECLARE
  target_policies constant jsonb := jsonb_build_array(
    jsonb_build_object('schema', 'cron', 'table', 'job', 'policy', 'cron_job_policy'),
    jsonb_build_object('schema', 'cron', 'table', 'job_run_details', 'policy', 'cron_job_run_details_policy'),
    jsonb_build_object('schema', 'public', 'table', 'credentials', 'policy', 'credentials_select_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'deck_progress', 'policy', 'deck_progress_delete_own'),
    jsonb_build_object('schema', 'public', 'table', 'deck_progress', 'policy', 'deck_progress_insert_own'),
    jsonb_build_object('schema', 'public', 'table', 'deck_progress', 'policy', 'deck_progress_select_own'),
    jsonb_build_object('schema', 'public', 'table', 'deck_progress', 'policy', 'deck_progress_update_own'),
    jsonb_build_object('schema', 'public', 'table', 'doctoralia_appointments_ingestion', 'policy', 'doctoralia_appointments_ingestion_select_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'doctoralia_appointments_raw', 'policy', 'doctoralia_appointments_raw_select_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'doctoralia_patients', 'policy', 'doctoralia_patients_select_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'doctoralia_raw', 'policy', 'doctoralia_raw_select_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'lead_events', 'policy', 'lead_events_select_own_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'patient_classification', 'policy', 'patient_classification_select_own_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'posts', 'policy', 'posts_delete_own'),
    jsonb_build_object('schema', 'public', 'table', 'posts', 'policy', 'posts_update_own'),
    jsonb_build_object('schema', 'public', 'table', 'treatment_types', 'policy', 'treatment_types_select_clinic'),
    jsonb_build_object('schema', 'public', 'table', 'whatsapp_conversations', 'policy', 'whatsapp_conversations_select_clinic')
  );
  target_policy jsonb;
  pol record;
  anonymous_guard constant text := 'COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS FALSE';
  new_qual text;
  new_with_check text;
BEGIN
  FOR target_policy IN SELECT * FROM jsonb_array_elements(target_policies)
  LOOP
    SELECT schemaname, tablename, policyname, qual, with_check
    INTO pol
    FROM pg_catalog.pg_policies
    WHERE schemaname = target_policy ->> 'schema'
      AND tablename = target_policy ->> 'table'
      AND policyname = target_policy ->> 'policy';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    new_qual := NULL;
    new_with_check := NULL;

    IF pol.qual IS NOT NULL THEN
      IF pol.qual ILIKE '%is_anonymous%' THEN
        new_qual := pol.qual;
      ELSE
        new_qual := format('(%s) AND (%s)', anonymous_guard, pol.qual);
      END IF;
    END IF;

    IF pol.with_check IS NOT NULL THEN
      IF pol.with_check ILIKE '%is_anonymous%' THEN
        new_with_check := pol.with_check;
      ELSE
        new_with_check := format('(%s) AND (%s)', anonymous_guard, pol.with_check);
      END IF;
    END IF;

    IF new_qual IS NOT NULL AND new_with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)', pol.policyname, pol.schemaname, pol.tablename, new_qual, new_with_check);
    ELSIF new_qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', pol.policyname, pol.schemaname, pol.tablename, new_qual);
    ELSIF new_with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', pol.policyname, pol.schemaname, pol.tablename, new_with_check);
    END IF;
  END LOOP;
END $$;
