-- Durable bridge from canonical Meta Lead Ads ingestion to HubSpot commercial routing.
-- Immediate row-level wakeups are non-blocking; the 3x/day cron is only an idle-aware fallback.

create table if not exists public.meta_hubspot_reconciliations (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'unmatched', 'unmatched_terminal', 'reconciled',
    'suppressed', 'conflict', 'failed', 'failed_terminal'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  hubspot_contact_id bigint,
  owner_id text,
  last_error text,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_hubspot_reconciliations_due_idx
  on public.meta_hubspot_reconciliations (next_attempt_at, updated_at)
  where status in ('pending', 'unmatched', 'failed');

alter table public.meta_hubspot_reconciliations enable row level security;
revoke all on table public.meta_hubspot_reconciliations from public, anon, authenticated;
grant select, insert, update, delete on table public.meta_hubspot_reconciliations to service_role;

create or replace function public.nvx_queue_meta_hubspot_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source <> 'meta_leadgen' or new.deleted_at is not null then
    return new;
  end if;

  insert into public.meta_hubspot_reconciliations (
    lead_id, status, attempt_count, next_attempt_at, hubspot_contact_id,
    last_error, reconciled_at, updated_at
  ) values (
    new.id, 'pending', 0, now(), new.hubspot_contact_id,
    null, null, now()
  )
  on conflict (lead_id) do update
  set status = 'pending',
      attempt_count = case
        when excluded.hubspot_contact_id is distinct from public.meta_hubspot_reconciliations.hubspot_contact_id then 0
        else public.meta_hubspot_reconciliations.attempt_count
      end,
      next_attempt_at = now(),
      hubspot_contact_id = excluded.hubspot_contact_id,
      last_error = null,
      reconciled_at = null,
      updated_at = now();

  perform public.nvx_try_dispatch_revops_worker('meta-hubspot-reconcile', 25, null);
  return new;
end;
$$;

revoke all on function public.nvx_queue_meta_hubspot_reconciliation() from public, anon, authenticated;

-- Only acquisition identity mutations can enqueue the worker. The worker's own
-- hubspot_contact_id write, plus ordinary CRM stage/revenue changes, must not
-- self-wake another reconciliation cycle.
drop trigger if exists meta_lead_hubspot_reconcile_wake_worker on public.leads;
create trigger meta_lead_hubspot_reconcile_wake_worker
after insert or update of email, phone, source, deleted_at
on public.leads
for each row
when (new.source = 'meta_leadgen' and new.deleted_at is null)
execute function public.nvx_queue_meta_hubspot_reconciliation();

-- Seed only recent active Meta leads. The historical backfill introduced by #344
-- will enqueue older recovered leads as it inserts/updates them after service recovery.
insert into public.meta_hubspot_reconciliations (lead_id, status, next_attempt_at)
select l.id, 'pending', now()
from public.leads l
where l.source = 'meta_leadgen'
  and l.deleted_at is null
  and l.created_at >= now() - interval '30 days'
on conflict (lead_id) do nothing;

-- Preserve the current low-consumption fallback cadence: three times/day,
-- and only when durable work is actually due.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'nvx-meta-hubspot-reconcile'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-meta-hubspot-reconcile',
  '0 4,12,20 * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('meta-hubspot-reconcile', 50, null)
    where exists (
      select 1
      from public.meta_hubspot_reconciliations
      where status in ('pending', 'unmatched', 'failed')
        and attempt_count < 6
        and next_attempt_at <= now()
      limit 1
    );
  $cron$
);
