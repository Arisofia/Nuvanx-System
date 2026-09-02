-- The doctor performance report is consumed server-side through the API Edge
-- Function using the service role. The view itself is SECURITY INVOKER and its
-- base relations intentionally do not expose a complete direct authenticated
-- read surface, so authenticated clients must not query the view directly.

begin;

revoke all on table public.vw_doctor_performance_real from anon, authenticated;
grant select on table public.vw_doctor_performance_real to service_role;

commit;
