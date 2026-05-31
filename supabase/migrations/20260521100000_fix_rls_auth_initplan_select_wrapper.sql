-- fix_rls_auth_initplan_select_wrapper
-- Recreate 13 RLS SELECT policies with proper (select auth.function()) wrapper
-- to fix auth_rls_initplan lint warnings and CI security check

DROP POLICY IF EXISTS integrations_select_clinic ON integrations;
CREATE POLICY integrations_select_clinic ON integrations FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS credentials_select_clinic ON credentials;
CREATE POLICY credentials_select_clinic ON credentials FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS api_call_log_select_own ON api_call_log;
CREATE POLICY api_call_log_select_own ON api_call_log FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND (SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS patients_select_clinic ON patients;
CREATE POLICY patients_select_clinic ON patients FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS doctors_select_clinic ON doctors;
CREATE POLICY doctors_select_clinic ON doctors FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS treatment_types_select_clinic ON treatment_types;
CREATE POLICY treatment_types_select_clinic ON treatment_types FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS appointments_select_clinic ON appointments;
CREATE POLICY appointments_select_clinic ON appointments FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS financial_settlements_select_clinic ON financial_settlements;
CREATE POLICY financial_settlements_select_clinic ON financial_settlements FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON doctoralia_patients;
CREATE POLICY doctoralia_patients_select_clinic ON doctoralia_patients FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS produccion_intermediarios_authenticated_select ON produccion_intermediarios;
CREATE POLICY produccion_intermediarios_authenticated_select ON produccion_intermediarios FOR SELECT USING ((SELECT auth.role()) = 'authenticated' AND (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true');

DROP POLICY IF EXISTS clinics_select_own ON clinics;
CREATE POLICY clinics_select_own ON clinics FOR SELECT USING (id = (SELECT current_clinic_id()) OR (id IN (SELECT clinic_id FROM users WHERE id = (SELECT auth.uid())) AND COALESCE(((SELECT (auth.jwt() ->> 'is_anonymous')))::boolean, false) = false));

DROP POLICY IF EXISTS leads_select_authenticated_or_clinic ON leads;
CREATE POLICY leads_select_authenticated_or_clinic ON leads FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));

DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select_clinic ON whatsapp_conversations FOR SELECT USING ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true' AND clinic_id = (SELECT current_clinic_id()));
