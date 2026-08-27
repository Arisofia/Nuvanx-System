-- Durable bridge from canonical Meta Lead Ads ingestion to HubSpot commercial routing.
-- Immediate row-level wakeups are non-blocking; the 3x/day cron is only an idle-aware fallback.
-- Commercial lifecycle history is append-only and contains no lead PII.

create table if not exists public.meta_hubspot_reconciliations (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'unmatched', 'unmatched_terminal', 'reconciled',
    'duplicate_suppressed', 'suppressed', 'conflict', 'failed', 'failed_terminal'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  hubspot_contact_id bigint,
  owner_id text,
  duplicate_of_lead_id uuid references public.leads(id),
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

create table if not exists public.lead_commercial_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id),
  event_type text not null check (event_type in (
    'synced', 'routed', 'duplicate_suppressed', 'routing_failed', 'routing_suppressed',
    'contacted', 'valuation_scheduled', 'valuation_attended', 'won', 'lost',
    'deal_created', 'deal_stage_changed', 'deal_failed'
  )),
  event_key text not null unique,
  occurred_at timestamptz not null default now(),
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_commercial_events_lead_time_idx
  on public.lead_commercial_events (lead_id, occurred_at);
create index if not exists lead_commercial_events_type_time_idx
  on public.lead_commercial_events (event_type, occurred_at);

alter table public.lead_commercial_events enable row level security;
revoke all on table public.lead_commercial_events from public, anon, authenticated;
grant select, insert on table public.lead_commercial_events to service_role;

create or replace function public.nvx_record_lead_commercial_event(
  p_lead_id uuid,
  p_event_type text,
  p_event_key text,
  p_occurred_at timestamptz default now(),
  p_source text default 'system',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_commercial_events (
    lead_id, event_type, event_key, occurred_at, source, metadata
  ) values (
    p_lead_id,
    p_event_type,
    p_event_key,
    coalesce(p_occurred_at, now()),
    nullif(trim(p_source), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (event_key) do nothing;
end;
$$;

revoke all on function public.nvx_record_lead_commercial_event(uuid,text,text,timestamptz,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.nvx_record_lead_commercial_event(uuid,text,text,timestamptz,text,jsonb)
  to service_role;

create or replace function public.nvx_record_meta_lead_state_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contacted_at timestamptz;
  v_state_at timestamptz;
begin
  if new.source <> 'meta_leadgen' or new.deleted_at is not null then
    return new;
  end if;

  perform public.nvx_record_lead_commercial_event(
    new.id,
    'synced',
    'synced:' || new.id::text,
    coalesce(new.created_at_meta, new.created_at),
    'meta_leadgen',
    '{}'::jsonb
  );

  v_contacted_at := coalesce(new.first_response_at, new.first_outbound_at, new.first_inbound_at, new.stage_canonical_updated_at, now());
  v_state_at := coalesce(new.stage_canonical_updated_at, new.updated_at, now());

  if new.first_response_at is not null
     or new.first_outbound_at is not null
     or new.first_inbound_at is not null
     or new.stage_canonical = 'contacto' then
    perform public.nvx_record_lead_commercial_event(
      new.id, 'contacted', 'contacted:' || new.id::text,
      v_contacted_at, 'lead_state', '{}'::jsonb
    );
  end if;

  if new.appointment_date is not null
     or new.appointment_status in ('scheduled', 'confirmed')
     or new.stage_canonical = 'valoracion_aceptada' then
    perform public.nvx_record_lead_commercial_event(
      new.id, 'valuation_scheduled', 'valuation_scheduled:' || new.id::text,
      v_state_at, 'lead_state', '{}'::jsonb
    );
  end if;

  if new.attended_at is not null
     or new.appointment_status = 'showed'
     or new.stage_canonical = 'asistio' then
    perform public.nvx_record_lead_commercial_event(
      new.id, 'valuation_attended', 'valuation_attended:' || new.id::text,
      coalesce(new.attended_at, v_state_at), 'lead_state', '{}'::jsonb
    );
  end if;

  if coalesce(new.verified_revenue, 0) > 0 then
    perform public.nvx_record_lead_commercial_event(
      new.id, 'won', 'won:' || new.id::text,
      v_state_at, 'verified_revenue', '{}'::jsonb
    );
  end if;

  if new.lost_reason is not null then
    perform public.nvx_record_lead_commercial_event(
      new.id, 'lost', 'lost:' || new.id::text || ':' || new.lost_reason::text,
      v_state_at, 'lead_state', jsonb_build_object('reason', new.lost_reason::text)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.nvx_record_meta_lead_state_events() from public, anon, authenticated;

drop trigger if exists meta_lead_commercial_state_events on public.leads;
create trigger meta_lead_commercial_state_events
after insert or update of
  source, deleted_at, first_response_at, first_outbound_at, first_inbound_at,
  appointment_date, appointment_status, attended_at, verified_revenue,
  lost_reason, stage_canonical, stage_canonical_updated_at
on public.leads
for each row
execute function public.nvx_record_meta_lead_state_events();

create or replace function public.nvx_record_meta_routing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'reconciled' then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'routed', 'routed:' || new.lead_id::text,
      coalesce(new.reconciled_at, now()), 'meta_hubspot_reconcile',
      jsonb_build_object('owner_assigned', new.owner_id is not null)
    );
  elsif new.status = 'duplicate_suppressed' then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'duplicate_suppressed', 'duplicate_suppressed:' || new.lead_id::text,
      coalesce(new.reconciled_at, now()), 'meta_hubspot_reconcile',
      jsonb_build_object('duplicate_of_lead_id', new.duplicate_of_lead_id)
    );
  elsif new.status in ('unmatched_terminal', 'conflict', 'failed_terminal') then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'routing_failed',
      'routing_failed:' || new.lead_id::text || ':' || new.status || ':' || new.attempt_count::text,
      now(), 'meta_hubspot_reconcile',
      jsonb_build_object('status', new.status, 'attempt_count', new.attempt_count)
    );
  elsif new.status = 'suppressed' then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'routing_suppressed', 'routing_suppressed:' || new.lead_id::text,
      coalesce(new.reconciled_at, now()), 'meta_hubspot_reconcile', '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

revoke all on function public.nvx_record_meta_routing_event() from public, anon, authenticated;

drop trigger if exists meta_hubspot_reconciliation_commercial_event on public.meta_hubspot_reconciliations;
create trigger meta_hubspot_reconciliation_commercial_event
after insert or update of status, attempt_count, owner_id, duplicate_of_lead_id
on public.meta_hubspot_reconciliations
for each row
when (
  new.status in (
    'reconciled', 'duplicate_suppressed', 'unmatched_terminal',
    'suppressed', 'conflict', 'failed_terminal'
  )
)
execute function public.nvx_record_meta_routing_event();

create or replace function public.nvx_record_deal_projection_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hubspot_deal_id is not null
     and (tg_op = 'INSERT' or old.hubspot_deal_id is null) then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'deal_created', 'deal_created:' || new.lead_id::text,
      coalesce(new.projected_at, now()), 'deal_factory',
      jsonb_build_object('stage_id', new.stage_id)
    );
  end if;

  if new.hubspot_deal_id is not null
     and (tg_op = 'INSERT' or old.stage_id is distinct from new.stage_id) then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'deal_stage_changed',
      'deal_stage:' || new.lead_id::text || ':' || new.stage_id,
      coalesce(new.projected_at, now()), 'deal_factory',
      jsonb_build_object('stage_id', new.stage_id)
    );
  end if;

  if new.projection_status = 'failed'
     and (tg_op = 'INSERT'
       or old.projection_status is distinct from 'failed'
       or old.attempt_count is distinct from new.attempt_count) then
    perform public.nvx_record_lead_commercial_event(
      new.lead_id, 'deal_failed',
      'deal_failed:' || new.lead_id::text || ':' || new.attempt_count::text,
      now(), 'deal_factory',
      jsonb_build_object('attempt_count', new.attempt_count)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.nvx_record_deal_projection_event() from public, anon, authenticated;

drop trigger if exists hubspot_deal_projection_commercial_event on public.hubspot_deal_projections;
create trigger hubspot_deal_projection_commercial_event
after insert or update of hubspot_deal_id, stage_id, projection_status, attempt_count
on public.hubspot_deal_projections
for each row
execute function public.nvx_record_deal_projection_event();

create or replace function public.nvx_requeue_deal_on_commercial_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null
     or new.source not in ('website_hubspot', 'meta_leadgen') then
    return new;
  end if;

  if new.first_response_at is not distinct from old.first_response_at
     and new.first_outbound_at is not distinct from old.first_outbound_at
     and new.first_inbound_at is not distinct from old.first_inbound_at
     and new.appointment_date is not distinct from old.appointment_date
     and new.appointment_status is not distinct from old.appointment_status
     and new.attended_at is not distinct from old.attended_at
     and new.verified_revenue is not distinct from old.verified_revenue
     and new.revenue is not distinct from old.revenue
     and new.lost_reason is not distinct from old.lost_reason
     and new.stage_canonical is not distinct from old.stage_canonical then
    return new;
  end if;

  update public.hubspot_deal_projections
  set projection_status = 'pending',
      last_error = null,
      updated_at = now()
  where lead_id = new.id
    and projection_status <> 'suppressed';

  return new;
end;
$$;

revoke all on function public.nvx_requeue_deal_on_commercial_change() from public, anon, authenticated;

drop trigger if exists lead_commercial_change_requeue_deal on public.leads;
create trigger lead_commercial_change_requeue_deal
after update of
  first_response_at, first_outbound_at, first_inbound_at,
  appointment_date, appointment_status, attended_at,
  verified_revenue, revenue, lost_reason, stage_canonical
on public.leads
for each row
execute function public.nvx_requeue_deal_on_commercial_change();

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
    duplicate_of_lead_id, last_error, reconciled_at, updated_at
  ) values (
    new.id, 'pending', 0, now(), new.hubspot_contact_id,
    null, null, null, now()
  )
  on conflict (lead_id) do update
  set status = 'pending',
      attempt_count = case
        when excluded.hubspot_contact_id is distinct from public.meta_hubspot_reconciliations.hubspot_contact_id then 0
        else public.meta_hubspot_reconciliations.attempt_count
      end,
      next_attempt_at = now(),
      hubspot_contact_id = excluded.hubspot_contact_id,
      duplicate_of_lead_id = null,
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

-- Seed active Meta leads. Historical source rows are acquisition evidence and
-- can be represented in the audit ledger without sending any provider writes.
insert into public.lead_commercial_events (lead_id, event_type, event_key, occurred_at, source)
select l.id, 'synced', 'synced:' || l.id::text, coalesce(l.created_at_meta, l.created_at), 'meta_leadgen'
from public.leads l
where l.source = 'meta_leadgen' and l.deleted_at is null
on conflict (event_key) do nothing;

insert into public.meta_hubspot_reconciliations (lead_id, status, next_attempt_at)
select l.id, 'pending', now()
from public.leads l
where l.source = 'meta_leadgen'
  and l.deleted_at is null
  and l.created_at >= now() - interval '30 days'
on conflict (lead_id) do nothing;

create or replace view public.vw_meta_commercial_funnel
with (security_invoker = true)
as
select
  l.id as lead_id,
  coalesce(l.created_at_meta, l.created_at) as synced_at,
  coalesce(l.meta_form_id, l.form_id) as form_id,
  l.campaign_id,
  coalesce(l.meta_ad_id, l.ad_id) as ad_id,
  r.status as routing_status,
  r.attempt_count as routing_attempt_count,
  r.reconciled_at as routed_at,
  (r.owner_id is not null) as owner_assigned,
  r.duplicate_of_lead_id,
  round((extract(epoch from (coalesce(r.reconciled_at, now()) - coalesce(l.created_at_meta, l.created_at))) / 60.0)::numeric, 2)
    as routing_latency_minutes,
  coalesce(l.first_response_sla_minutes, 30) as routing_sla_minutes,
  case
    when r.status in ('reconciled', 'duplicate_suppressed') then
      extract(epoch from (coalesce(r.reconciled_at, now()) - coalesce(l.created_at_meta, l.created_at))) / 60.0
        > coalesce(l.first_response_sla_minutes, 30)
    when r.status in ('pending', 'unmatched', 'failed') then
      extract(epoch from (now() - coalesce(l.created_at_meta, l.created_at))) / 60.0
        > coalesce(l.first_response_sla_minutes, 30)
    else false
  end as routing_sla_breached,
  p.projection_status,
  p.hubspot_deal_id,
  p.stage_id as deal_stage_id,
  p.projected_at as deal_projected_at,
  (p.hubspot_deal_id is not null) as deal_created,
  case
    when coalesce(l.verified_revenue, 0) > 0 then 'won'
    when l.lost_reason is not null then 'lost'
    when l.attended_at is not null or l.appointment_status = 'showed' or l.stage_canonical = 'asistio' then 'valuation_attended'
    when l.appointment_date is not null or l.appointment_status in ('scheduled', 'confirmed') or l.stage_canonical = 'valoracion_aceptada' then 'valuation_scheduled'
    when l.first_response_at is not null or l.first_outbound_at is not null or l.first_inbound_at is not null or l.stage_canonical = 'contacto' then 'contacted'
    else 'lead'
  end as commercial_stage
from public.leads l
left join public.meta_hubspot_reconciliations r on r.lead_id = l.id
left join public.hubspot_deal_projections p on p.lead_id = l.id
where l.source = 'meta_leadgen'
  and l.deleted_at is null;

revoke all on public.vw_meta_commercial_funnel from public, anon, authenticated;
grant select on public.vw_meta_commercial_funnel to service_role;

create or replace view public.vw_meta_commercial_funnel_metrics
with (security_invoker = true)
as
select
  count(*) as synced,
  count(*) filter (where routing_status = 'reconciled') as routed,
  count(*) filter (where owner_assigned) as owner_assigned,
  count(*) filter (where routing_status = 'duplicate_suppressed') as duplicates_suppressed,
  count(*) filter (where routing_status in ('unmatched_terminal', 'conflict', 'failed_terminal')) as routing_failures,
  count(*) filter (where routing_sla_breached) as routing_sla_breaches,
  count(*) filter (where deal_created) as deals_created,
  count(*) filter (where commercial_stage in ('contacted', 'valuation_scheduled', 'valuation_attended', 'won')) as contacted_or_beyond,
  count(*) filter (where commercial_stage in ('valuation_scheduled', 'valuation_attended', 'won')) as valuation_scheduled_or_beyond,
  count(*) filter (where commercial_stage in ('valuation_attended', 'won')) as valuation_attended_or_beyond,
  count(*) filter (where commercial_stage = 'won') as won
from public.vw_meta_commercial_funnel;

revoke all on public.vw_meta_commercial_funnel_metrics from public, anon, authenticated;
grant select on public.vw_meta_commercial_funnel_metrics to service_role;

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
