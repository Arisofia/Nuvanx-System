-- RLS policies for doctoralia_patients and doctoralia_lead_matches
-- Resolves lint 0008 (rls_enabled_no_policy) on both tables.

-- doctoralia_patients: clinic-scoped; authenticated users may only see rows
-- belonging to their own clinic (same pattern as patients, appointments, etc.)
DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- Service role retains full access for the ingest / matching function.
DROP POLICY IF EXISTS doctoralia_patients_service_role ON public.doctoralia_patients;
CREATE POLICY doctoralia_patients_service_role ON public.doctoralia_patients
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- doctoralia_lead_matches: internal match-audit log — no clinic_id column,
-- not meant for direct authenticated access.  Restrict to service_role only.
DROP POLICY IF EXISTS doctoralia_lead_matches_service_role ON public.doctoralia_lead_matches;
CREATE POLICY doctoralia_lead_matches_service_role ON public.doctoralia_lead_matches
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
