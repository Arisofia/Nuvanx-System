-- Race-safe HubSpot Deal projection lifecycle.
--
-- Root cause:
-- deal-factory historically selected pending/failed/created rows directly. `created`
-- acted as an implicit re-sync mechanism because no explicit invalidation owner existed,
-- while direct SELECTs allowed concurrent wakeups to process the same projection.
--
-- This migration makes queue ownership explicit:
--   * atomically claim pending/failed (or stale processing) rows with SKIP LOCKED;
--   * mark relevant lead-input changes dirty instead of reprocessing every created row;
--   * preserve changes that arrive while a projection is creating/updating;
--   * finalize only the currently-owned claim token;
--   * let the scheduled fallback recover stale claims without broad created replays.

begin;

alter table public.hubspot_deal_projections
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists needs_reprojection boolean not null default false;

create index if not exists idx_hubspot_deal_projections_work_queue
  on public.hubspot_deal_projections (projection_status, updated_at)
  where projection_status in ('pending', 'failed', 'creating', 'updating');

create or replace function public.nvx_mark_hubspot_deal_projection_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- A projection currently owned by a worker must not be released to another
  -- worker. Record the dirty input and let the current claim finalize back to
  -- pending after its provider attempt completes.
  update public.hubspot_deal_projections p
  set needs_reprojection = true,
      updated_at = pg_catalog.now()
  where p.lead_id = new.id
    and p.projection_status in ('creating', 'updating');

  -- Stable/failed projections can be invalidated immediately. The existing
  -- projection_status trigger then wakes Deal Factory naturally.
  update public.hubspot_deal_projections p
  set projection_status = 'pending',
      needs_reprojection = false,
      last_error = null,
      updated_at = pg_catalog.now()
  where p.lead_id = new.id
    and p.projection_status in ('created', 'failed');

  return new;
end;
$function$;

revoke all on function public.nvx_mark_hubspot_deal_projection_dirty() from public, anon, authenticated;

-- Only fields consumed by dealProperties()/chooseStage() invalidate a Deal.
-- Do not use generic leads.updated_at: Deal Factory itself writes hubspot_deal_id
-- and would otherwise create a feedback loop.
drop trigger if exists trg_nvx_invalidate_hubspot_deal_projection on public.leads;
create trigger trg_nvx_invalidate_hubspot_deal_projection
after update of
  verified_revenue,
  revenue,
  appointment_date,
  attended_at,
  first_response_at,
  first_outbound_at
on public.leads
for each row
when (
  old.verified_revenue is distinct from new.verified_revenue
  or old.revenue is distinct from new.revenue
  or old.appointment_date is distinct from new.appointment_date
  or old.attended_at is distinct from new.attended_at
  or old.first_response_at is distinct from new.first_response_at
  or old.first_outbound_at is distinct from new.first_outbound_at
)
execute function public.nvx_mark_hubspot_deal_projection_dirty();

create or replace function public.nvx_claim_hubspot_deal_projections(
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns table (
  lead_id uuid,
  hubspot_contact_id bigint,
  hubspot_deal_id bigint,
  pipeline_id text,
  stage_id text,
  owner_id text,
  amount numeric,
  currency_code text,
  projection_status text,
  attempt_count integer,
  claim_token uuid,
  claimed_at timestamptz,
  needs_reprojection boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 300), 3600));
  v_stale_before timestamptz;
begin
  v_stale_before := pg_catalog.now() - pg_catalog.make_interval(secs => v_lease_seconds);

  return query
  with candidates as (
    select p.lead_id
    from public.hubspot_deal_projections p
    where p.projection_status in ('pending', 'failed')
       or (
         p.projection_status in ('creating', 'updating')
         and (p.claimed_at is null or p.claimed_at < v_stale_before)
       )
    order by p.updated_at asc, p.lead_id
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.hubspot_deal_projections p
    set projection_status = case
          when p.hubspot_deal_id is null then 'creating'
          else 'updating'
        end,
        attempt_count = p.attempt_count + 1,
        claim_token = pg_catalog.gen_random_uuid(),
        claimed_at = pg_catalog.now(),
        needs_reprojection = false,
        last_error = null,
        updated_at = pg_catalog.now()
    from candidates c
    where p.lead_id = c.lead_id
    returning
      p.lead_id,
      p.hubspot_contact_id,
      p.hubspot_deal_id,
      p.pipeline_id,
      p.stage_id,
      p.owner_id,
      p.amount,
      p.currency_code,
      p.projection_status,
      p.attempt_count,
      p.claim_token,
      p.claimed_at,
      p.needs_reprojection
  )
  select * from claimed;
end;
$function$;

revoke all on function public.nvx_claim_hubspot_deal_projections(integer, integer) from public, anon, authenticated;
grant execute on function public.nvx_claim_hubspot_deal_projections(integer, integer) to service_role;

create or replace function public.nvx_finalize_hubspot_deal_projection(
  p_lead_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_hubspot_deal_id bigint default null,
  p_stage_id text default null,
  p_amount numeric default null,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dirty boolean;
  v_status text;
begin
  if p_claim_token is null then
    return 'claim_lost';
  end if;

  select p.needs_reprojection
  into v_dirty
  from public.hubspot_deal_projections p
  where p.lead_id = p_lead_id
    and p.claim_token = p_claim_token
    and p.projection_status in ('creating', 'updating')
  for update;

  if not found then
    return 'claim_lost';
  end if;

  if p_outcome = 'success' then
    if p_hubspot_deal_id is null or p_hubspot_deal_id <= 0 then
      raise exception 'Successful Deal projection requires a HubSpot Deal id';
    end if;

    v_status := case when v_dirty then 'pending' else 'created' end;

    update public.hubspot_deal_projections p
    set hubspot_deal_id = p_hubspot_deal_id,
        stage_id = coalesce(nullif(pg_catalog.btrim(p_stage_id), ''), p.stage_id),
        amount = p_amount,
        projection_status = v_status,
        projected_at = pg_catalog.now(),
        last_error = null,
        claim_token = null,
        claimed_at = null,
        needs_reprojection = false,
        updated_at = pg_catalog.now()
    where p.lead_id = p_lead_id
      and p.claim_token = p_claim_token;

    return v_status;
  end if;

  if p_outcome = 'suppressed' then
    update public.hubspot_deal_projections p
    set projection_status = 'suppressed',
        last_error = null,
        claim_token = null,
        claimed_at = null,
        needs_reprojection = false,
        updated_at = pg_catalog.now()
    where p.lead_id = p_lead_id
      and p.claim_token = p_claim_token;
    return 'suppressed';
  end if;

  if p_outcome = 'failed' then
    update public.hubspot_deal_projections p
    set projection_status = 'failed',
        last_error = pg_catalog.left(coalesce(p_error, 'Deal projection failed'), 240),
        claim_token = null,
        claimed_at = null,
        needs_reprojection = false,
        updated_at = pg_catalog.now()
    where p.lead_id = p_lead_id
      and p.claim_token = p_claim_token;
    return 'failed';
  end if;

  raise exception 'Unsupported Deal projection outcome';
end;
$function$;

revoke all on function public.nvx_finalize_hubspot_deal_projection(uuid, uuid, text, bigint, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.nvx_finalize_hubspot_deal_projection(uuid, uuid, text, bigint, text, numeric, text)
  to service_role;

comment on function public.nvx_claim_hubspot_deal_projections(integer, integer) is
'Atomically claims pending/failed or stale HubSpot Deal projections with FOR UPDATE SKIP LOCKED. created rows are never broad-replayed.';

comment on function public.nvx_finalize_hubspot_deal_projection(uuid, uuid, text, bigint, text, numeric, text) is
'Finalizes only the currently-owned Deal projection claim. Dirty inputs observed during provider execution return the row to pending rather than losing the change.';

-- Keep the fallback cadence, but also wake for a genuinely stale processing lease.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'nvx-deal-factory'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-deal-factory',
  '0 4,12,20 * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('deal-factory', 50, null)
    where exists (
      select 1
      from public.hubspot_deal_projections
      where projection_status in ('pending', 'failed')
         or (
           projection_status in ('creating', 'updating')
           and (claimed_at is null or claimed_at < now() - interval '5 minutes')
         )
      limit 1
    );
  $cron$
);

commit;
