begin;

-- Canonical forward-order repair. Migration 20260901080300 intentionally
-- hardened SECURITY DEFINER RPC access but accidentally revoked the two
-- authenticated Control Centre read surfaces below. Reassert the intended ACL
-- after that hardening step so clean replays and Production converge.
revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from public;
revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from anon;
grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to authenticated, service_role;

revoke all on function public.nvx_get_attribution_health() from public;
revoke all on function public.nvx_get_attribution_health() from anon;
grant execute on function public.nvx_get_attribution_health() to authenticated, service_role;

commit;
