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

-- leads
DROP POLICY IF EXISTS leads_select_clinic ON public.leads;
CREATE POLICY leads_select_clinic ON public.leads
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = public.current_clinic_id()
  );

-- integrations
DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
CREATE POLICY integrations_select_clinic ON public.integrations
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = public.current_clinic_id()
  );

-- credentials
DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
CREATE POLICY credentials_select_clinic ON public.credentials
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = public.current_clinic_id()
  );

-- api_call_log (user-scoped rather than clinic-scoped)
DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
CREATE POLICY api_call_log_select_own ON public.api_call_log
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND auth.uid() = user_id
  );

-- doctoralia_patients (table may not exist in all environments)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND clinic_id = public.current_clinic_id()
      );
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
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_select_clinic ON public.%I'
        ' FOR SELECT TO authenticated'
        ' USING ((auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'''
        '        AND clinic_id = public.current_clinic_id())',
        t, t
      );
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
