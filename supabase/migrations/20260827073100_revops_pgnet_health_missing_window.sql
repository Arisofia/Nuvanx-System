-- Follow-up to the async pg_net health migration: a response declared missing
-- after 10 minutes must remain inside the fail-closed health lookback long enough
-- to be observable. Keep the reconcile threshold at 10 minutes and widen the
-- health window to 15 minutes.

create or replace function public.nvx_assert_revops_dispatch_health()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed bigint;
  v_missing bigint;
  v_latest_status integer;
begin
  perform public.nvx_reconcile_revops_dispatch_attempts();

  select
    count(*) filter (where outcome = 'failed'),
    count(*) filter (where outcome = 'missing_response'),
    max(response_status) filter (where outcome = 'failed')
  into v_failed, v_missing, v_latest_status
  from public.revops_dispatch_attempts
  where requested_at >= now() - interval '15 minutes';

  if coalesce(v_failed, 0) > 0 or coalesce(v_missing, 0) > 0 then
    raise exception 'RevOps async dispatch health failed: failed=%, missing_response=%, latest_status=%',
      coalesce(v_failed, 0),
      coalesce(v_missing, 0),
      coalesce(v_latest_status::text, 'none');
  end if;

  return true;
end;
$$;

revoke all on function public.nvx_assert_revops_dispatch_health() from public, anon, authenticated;
grant execute on function public.nvx_assert_revops_dispatch_health() to service_role;
