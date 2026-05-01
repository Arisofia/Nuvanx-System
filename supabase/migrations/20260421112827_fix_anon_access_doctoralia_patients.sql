-- Resolves lint 0012 (auth_allow_anonymous_sign_ins) on doctoralia_patients.
--
-- Anonymous sign-ins are enabled on this project, which means anonymous users
-- receive the `authenticated` role.  The existing SELECT policy targeted
-- `TO authenticated` without excluding anonymous sessions, so the linter
-- flagged it.  We add `(auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'`
-- to the USING clause to explicitly block anonymous users.  The clinic_id check
-- already prevented them from seeing any rows, but this makes the intent
-- explicit and silences the security linter.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
ALTER TABLE public.doctoralia_patients ENABLE ROW LEVEL SECURITY;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
      );
  END IF;
END $$;
