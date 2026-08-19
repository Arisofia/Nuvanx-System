-- Hotfix follow-up to 20260819193100_route_revops_dispatcher.sql.
-- Automatic trigger/cron wakeups must never make the underlying business
-- transaction fail when runtime bootstrap, Vault routing, or transport is unavailable.
-- The strict dispatcher remains unchanged for explicit service-role calls.

create or replace function public.nvx_try_dispatch_revops_worker(
  p_worker text,
  p_limit integer default 25,
  p_mode text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.nvx_dispatch_revops_worker(p_worker, p_limit, p_mode);
exception
  when others then
    return null;
end;
$$;

revoke all on function public.nvx_try_dispatch_revops_worker(text,integer,text) from public, anon, authenticated;
grant execute on function public.nvx_try_dispatch_revops_worker(text,integer,text) to service_role;

create or replace function public.nvx_wake_deal_factory_on_pending_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.projection_status = 'pending'
     and (tg_op = 'INSERT' or old.projection_status is distinct from 'pending') then
    perform public.nvx_try_dispatch_revops_worker('deal-factory', 20, null);
  end if;
  return new;
end;
$$;

revoke all on function public.nvx_wake_deal_factory_on_pending_projection() from public, anon, authenticated;

create or replace function public.nvx_wake_google_data_manager_on_pending_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_test_lead, false) = false
     and new.delivery_status = 'pending'
     and (tg_op = 'INSERT' or old.delivery_status is distinct from 'pending') then
    perform public.nvx_try_dispatch_revops_worker('google-data-manager-export', 20, 'deliver');
  end if;
  return new;
end;
$$;

revoke all on function public.nvx_wake_google_data_manager_on_pending_outbox() from public, anon, authenticated;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in (
      'nvx-web-lead-reconcile',
      'nvx-deal-factory',
      'nvx-google-data-manager-deliver',
      'nvx-google-data-manager-poll'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-web-lead-reconcile',
  '*/5 * * * *',
  $cron$select public.nvx_try_dispatch_revops_worker('web-lead-reconcile', 50, null);$cron$
);

select cron.schedule(
  'nvx-deal-factory',
  '*/5 * * * *',
  $cron$select public.nvx_try_dispatch_revops_worker('deal-factory', 50, null);$cron$
);

select cron.schedule(
  'nvx-google-data-manager-deliver',
  '*/5 * * * *',
  $cron$select public.nvx_try_dispatch_revops_worker('google-data-manager-export', 50, 'deliver');$cron$
);

select cron.schedule(
  'nvx-google-data-manager-poll',
  '2-59/5 * * * *',
  $cron$select public.nvx_try_dispatch_revops_worker('google-data-manager-export', 50, 'poll');$cron$
);
