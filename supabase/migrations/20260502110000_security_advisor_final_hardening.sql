-- =============================================================================
-- Final pass: resolve remaining Supabase security advisor warnings
--
-- 1. Revoke PUBLIC EXECUTE on auth-trigger SECURITY DEFINER functions
--    (previous migration only revoked from anon+authenticated, leaving the
--    default PUBLIC grant intact — linter still flagged them)
--
-- 2. Re-add is_anonymous guard to all clinic-scoped SELECT policies
--    (20260501190000_phase3_sql_hardening recreated policies without the guard
--    that was previously added by 20260419173000 and siblings)
--
-- 3. Re-apply cron policy hardening (remove anon from cron.job* policies)
--    (20260427212739 may have run before the cron extension created policies)
--
-- NOTE: auth_leaked_password_protection requires a Supabase dashboard change
--       (Auth → Password Security → Enable leaked password protection).
--       It cannot be addressed via a SQL migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Revoke PUBLIC EXECUTE on trigger-only SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn_name TEXT;
BEGIN
  FOREACH fn_name IN ARRAY ARRAY['handle_new_auth_user', 'handle_auth_user_change']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn_name
    ) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC', fn_name);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Re-add is_anonymous guard to clinic-scoped SELECT policies
--    (phase3 migration recreated these without the guard)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  core_tables TEXT[] := ARRAY['leads', 'integrations', 'credentials'];
BEGIN
  FOREACH t IN ARRAY core_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = t
           AND c.column_name = 'clinic_id'
       ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_select_clinic ON public.%I'
        ' FOR SELECT TO authenticated'
        ' USING ((auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'''
        '        AND clinic_id = public.current_clinic_id())',
        t, t
      );
    ELSE
      RAISE NOTICE 'Skipping %_select_clinic anonymous guard: table or clinic_id column does not exist', t;
    END IF;
  END LOOP;
END $$;

-- api_call_log (user-scoped rather than clinic-scoped)
DO $$
BEGIN
  IF to_regclass('public.api_call_log') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = 'api_call_log'
         AND c.column_name = 'user_id'
     ) THEN
    DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
    CREATE POLICY api_call_log_select_own ON public.api_call_log
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND auth.uid() = user_id
      );
  ELSE
    RAISE NOTICE 'Skipping api_call_log_select_own anonymous guard: table or user_id column does not exist';
  END IF;
END $$;

-- doctoralia_patients (table may not exist in all environments)
DO $$
BEGIN
  IF to_regclass('public.doctoralia_patients') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = 'doctoralia_patients'
         AND c.column_name = 'clinic_id'
     ) THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND clinic_id = public.current_clinic_id()
      );
  ELSE
    RAISE NOTICE 'Skipping doctoralia_patients_select_clinic anonymous guard: table or clinic_id column does not exist';
  END IF;
END $$;

-- patients, doctors, treatment_types, appointments, financial_settlements, whatsapp_conversations
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'patients', 'doctors', 'treatment_types',
    'appointments', 'financial_settlements', 'whatsapp_conversations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = t
           AND c.column_name = 'clinic_id'
       ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_select_clinic ON public.%I'
        ' FOR SELECT TO authenticated'
        ' USING ((auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'''
        '        AND clinic_id = public.current_clinic_id())',
        t, t
      );
    ELSE
      RAISE NOTICE 'Skipping %_select_clinic anonymous guard: table or clinic_id column does not exist', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Harden cron schema policies — remove anon role
--    pg_cron creates these policies; ALTER POLICY removes anon from the TO list
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'cron'
      AND tablename IN ('job', 'job_run_details')
      AND 'anon' = ANY(roles)
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO authenticated',
      pol.policyname, pol.schemaname, pol.tablename
    );
  END LOOP;
END $$;
