-- Restore SECURITY DEFINER on authenticated read/write RPCs whose applied migrations
-- recorded that contract but whose Production attributes drifted out-of-band to
-- SECURITY INVOKER. Their underlying views/tables intentionally remain closed to
-- direct authenticated access. Keep those data surfaces private and elevate only
-- the bounded RPCs that already enforce auth/tenant scoping in their function bodies.
-- All affected functions retain their existing explicit empty search_path.

ALTER FUNCTION public.nvx_get_control_centre_pipeline(integer, integer)
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_get_control_centre_lead_timeline(uuid, integer)
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text)
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_get_hubspot_marketing_contact_monitor()
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_get_attribution_health()
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_get_dashboard_metrics_v2(date, date, text, text)
  SECURITY DEFINER;

-- Reinforce least-privilege execution grants without granting direct access to the
-- underlying ledgers/views.
REVOKE ALL ON FUNCTION public.nvx_get_control_centre_pipeline(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_pipeline(integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_get_control_centre_lead_timeline(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_lead_timeline(uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_get_attribution_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_attribution_health() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_get_dashboard_metrics_v2(date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_dashboard_metrics_v2(date, date, text, text) TO authenticated, service_role;
