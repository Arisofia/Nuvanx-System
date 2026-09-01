begin;

-- Production ledger parity for the emergency repair applied on 2026-09-01.
-- The browser Control Centre calls these SECURITY DEFINER RPCs from an
-- authenticated session. Each RPC retains its own authentication/tenant guard;
-- only function EXECUTE is restored here. PUBLIC and anon remain closed.
revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from public;
revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from anon;
grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to authenticated, service_role;

revoke all on function public.nvx_get_attribution_health() from public;
revoke all on function public.nvx_get_attribution_health() from anon;
grant execute on function public.nvx_get_attribution_health() to authenticated, service_role;

commit;
