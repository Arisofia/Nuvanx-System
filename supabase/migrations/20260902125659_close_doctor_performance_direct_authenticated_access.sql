begin;
revoke all on table public.vw_doctor_performance_real from anon, authenticated;
grant select on table public.vw_doctor_performance_real to service_role;
commit;
