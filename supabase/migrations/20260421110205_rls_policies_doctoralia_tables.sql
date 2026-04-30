-- RLS policies for doctoralia_patients and doctoralia_lead_matches
-- Resolves lint 0008 (rls_enabled_no_policy) on both tables.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

    DROP POLICY IF EXISTS doctoralia_patients_service_role ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_service_role ON public.doctoralia_patients
      FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doctoralia_lead_matches'
  ) THEN
    DROP POLICY IF EXISTS doctoralia_lead_matches_service_role ON public.doctoralia_lead_matches;
    CREATE POLICY doctoralia_lead_matches_service_role ON public.doctoralia_lead_matches
      FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;
