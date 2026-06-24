-- fix_rls_auth_initplan_select_wrapper
-- Recreate RLS SELECT policies with proper (select auth.function()) wrappers
-- when their target tables exist in the current schema.

DO $$
DECLARE
  policy_definitions CONSTANT JSONB := jsonb_build_array(
    jsonb_build_object('table', 'integrations', 'policy', 'integrations_select_clinic', 'sql', 'CREATE POLICY integrations_select_clinic ON public.integrations FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'credentials', 'policy', 'credentials_select_clinic', 'sql', 'CREATE POLICY credentials_select_clinic ON public.credentials FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'api_call_log', 'policy', 'api_call_log_select_own', 'sql', 'CREATE POLICY api_call_log_select_own ON public.api_call_log FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND (SELECT auth.uid()) = user_id)'),
    jsonb_build_object('table', 'patients', 'policy', 'patients_select_clinic', 'sql', 'CREATE POLICY patients_select_clinic ON public.patients FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'doctors', 'policy', 'doctors_select_clinic', 'sql', 'CREATE POLICY doctors_select_clinic ON public.doctors FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'treatment_types', 'policy', 'treatment_types_select_clinic', 'sql', 'CREATE POLICY treatment_types_select_clinic ON public.treatment_types FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'appointments', 'policy', 'appointments_select_clinic', 'sql', 'CREATE POLICY appointments_select_clinic ON public.appointments FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'financial_settlements', 'policy', 'financial_settlements_select_clinic', 'sql', 'CREATE POLICY financial_settlements_select_clinic ON public.financial_settlements FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'doctoralia_patients', 'policy', 'doctoralia_patients_select_clinic', 'sql', 'CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'produccion_intermediarios', 'policy', 'produccion_intermediarios_authenticated_select', 'sql', 'CREATE POLICY produccion_intermediarios_authenticated_select ON public.produccion_intermediarios FOR SELECT USING ((SELECT auth.role()) = ''authenticated'' AND (SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'')'),
    jsonb_build_object('table', 'clinics', 'policy', 'clinics_select_own', 'sql', 'CREATE POLICY clinics_select_own ON public.clinics FOR SELECT USING (id = (SELECT current_clinic_id()) OR (id IN (SELECT clinic_id FROM public.users WHERE id = (SELECT auth.uid())) AND COALESCE(((SELECT (auth.jwt() ->> ''is_anonymous'')))::boolean, false) = false))'),
    jsonb_build_object('table', 'leads', 'policy', 'leads_select_authenticated_or_clinic', 'sql', 'CREATE POLICY leads_select_authenticated_or_clinic ON public.leads FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))'),
    jsonb_build_object('table', 'whatsapp_conversations', 'policy', 'whatsapp_conversations_select_clinic', 'sql', 'CREATE POLICY whatsapp_conversations_select_clinic ON public.whatsapp_conversations FOR SELECT USING ((SELECT (auth.jwt() ->> ''is_anonymous'')) IS DISTINCT FROM ''true'' AND clinic_id = (SELECT current_clinic_id()))')
  );
  policy_definition JSONB;
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOR policy_definition IN SELECT value FROM jsonb_array_elements(policy_definitions)
  LOOP
    table_name := policy_definition->>'table';
    policy_name := policy_definition->>'policy';

    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE NOTICE 'Skipping policy %: public.% does not exist yet', policy_name, table_name;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    EXECUTE policy_definition->>'sql';
  END LOOP;
END $$;
