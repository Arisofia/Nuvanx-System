-- Restore the execution contract recorded by the applied Control Centre migrations.
-- Production drifted out-of-band to SECURITY INVOKER, which makes authenticated RPC
-- calls fail because the underlying views/tables intentionally remain closed to direct access.
-- Keep the data surfaces private and elevate only the tenant-scoped RPC functions.

ALTER FUNCTION public.nvx_get_control_centre_pipeline(integer, integer)
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_get_control_centre_lead_timeline(uuid, integer)
  SECURITY DEFINER;

ALTER FUNCTION public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text)
  SECURITY DEFINER;

-- Preserve the explicit empty search_path already set on each function and reinforce
-- least-privilege execution grants. The function bodies continue to scope by auth.uid().
REVOKE ALL ON FUNCTION public.nvx_get_control_centre_pipeline(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_pipeline(integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_get_control_centre_lead_timeline(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_lead_timeline(uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) TO authenticated, service_role;
