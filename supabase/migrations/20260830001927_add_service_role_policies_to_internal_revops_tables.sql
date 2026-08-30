-- Complete defense-in-depth for server-only RevOps tables.
-- anon/authenticated have no grants or policies; service_role is the sole application role.

DROP POLICY IF EXISTS google_click_attributions_service_role_all ON public.google_click_attributions;
CREATE POLICY google_click_attributions_service_role_all
ON public.google_click_attributions
FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS google_data_manager_outbox_service_role_all ON public.google_data_manager_outbox;
CREATE POLICY google_data_manager_outbox_service_role_all
ON public.google_data_manager_outbox
FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS hubspot_deal_projections_service_role_all ON public.hubspot_deal_projections;
CREATE POLICY hubspot_deal_projections_service_role_all
ON public.hubspot_deal_projections
FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lead_appointment_matches_service_role_all ON public.lead_appointment_matches;
CREATE POLICY lead_appointment_matches_service_role_all
ON public.lead_appointment_matches
FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS web_lead_captures_service_role_all ON public.web_lead_captures;
CREATE POLICY web_lead_captures_service_role_all
ON public.web_lead_captures
FOR ALL TO service_role
USING (true) WITH CHECK (true);
