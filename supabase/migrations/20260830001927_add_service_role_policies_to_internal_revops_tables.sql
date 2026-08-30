CREATE POLICY google_click_attributions_service_role_all
ON public.google_click_attributions
FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY google_data_manager_outbox_service_role_all
ON public.google_data_manager_outbox
FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY hubspot_deal_projections_service_role_all
ON public.hubspot_deal_projections
FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY lead_appointment_matches_service_role_all
ON public.lead_appointment_matches
FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY web_lead_captures_service_role_all
ON public.web_lead_captures
FOR ALL TO service_role
USING (true) WITH CHECK (true);
