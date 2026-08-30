-- Restore defense-in-depth on internal RevOps tables.
-- These tables are server-side only: service_role retains grants and bypasses RLS;
-- anon/authenticated remain explicitly revoked and no permissive policies are created.

ALTER TABLE public.google_click_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_data_manager_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubspot_deal_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_appointment_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_lead_captures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_click_attributions FROM anon, authenticated;
REVOKE ALL ON TABLE public.google_data_manager_outbox FROM anon, authenticated;
REVOKE ALL ON TABLE public.hubspot_deal_projections FROM anon, authenticated;
REVOKE ALL ON TABLE public.lead_appointment_matches FROM anon, authenticated;
REVOKE ALL ON TABLE public.web_lead_captures FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_click_attributions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_data_manager_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hubspot_deal_projections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_appointment_matches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.web_lead_captures TO service_role;

-- Persist the runtime hardening of the SECURITY DEFINER maintenance dispatcher.
REVOKE ALL ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date) TO service_role;

COMMENT ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date)
IS 'Internal maintenance dispatcher. SECURITY DEFINER; executable only by service_role.';
