-- Durable, consent-gated Meta CAPI delivery for reconciled website leads.
--
-- Ownership:
--   web capture -> finalize_web_capture_reconciliation() -> meta_capi_outbox
--   meta-capi-dispatch -> web-events -> Meta CAPI
--
-- The outbox stores no contact PII. Delivery reads the already-authoritative
-- public.leads row under service_role. QA captures never reach this path.

create table if not exists public.meta_capi_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_name text not null default 'Lead'
    constraint meta_capi_outbox_event_name_check check (event_name = 'Lead'),
  event_id text not null,
  status text not null default 'pending'
    constraint meta_capi_outbox_status_check
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0
    constraint meta_capi_outbox_attempts_check check (attempts >= 0 and attempts <= 100),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_capi_outbox_lead_event_unique unique (lead_id, event_name),
  constraint meta_capi_outbox_event_id_unique unique (event_id)
);

create index if not exists idx_meta_capi_outbox_delivery
  on public.meta_capi_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

alter table public.meta_capi_outbox enable row level security;
revoke all on table public.meta_capi_outbox from public, anon, authenticated;
grant all on table public.meta_capi_outbox to service_role;

drop policy if exists meta_capi_outbox_service_role_all on public.meta_capi_outbox;
create policy meta_capi_outbox_service_role_all
  on public.meta_capi_outbox
  for all to service_role
  using (true)
  with check (true);

-- Atomic claim with lease recovery. A crashed worker can be reclaimed after
-- 15 minutes. FOR UPDATE SKIP LOCKED prevents concurrent workers from claiming
-- the same event before Meta's event_id deduplication is needed.
create or replace function public.nvx_claim_meta_capi_outbox(p_limit integer default 25)
returns setof public.meta_capi_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select o.id
    from public.meta_capi_outbox o
    where o.attempts < 8
      and (
        (o.status in ('pending', 'failed') and o.next_attempt_at <= pg_catalog.now())
        or
        (o.status = 'processing' and o.last_attempt_at < pg_catalog.now() - interval '15 minutes')
      )
    order by o.next_attempt_at asc, o.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.meta_capi_outbox o
  set status = 'processing',
      attempts = o.attempts + 1,
      last_attempt_at = pg_catalog.now(),
      updated_at = pg_catalog.now(),
      last_error = null
  from candidates c
  where o.id = c.id
  returning o.*;
end;
$$;

revoke all on function public.nvx_claim_meta_capi_outbox(integer) from public, anon, authenticated;
grant execute on function public.nvx_claim_meta_capi_outbox(integer) to service_role;

-- Extend the canonical RevOps dispatcher allowlist with the Meta CAPI worker.
create or replace function public.nvx_dispatch_revops_worker(
  p_worker text,
  p_limit integer default 25,
  p_mode text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_project_url text;
  v_limit integer;
  v_mode text;
  v_body jsonb;
  v_request_id bigint;
begin
  if p_worker not in ('web-lead-reconcile', 'deal-factory', 'google-data-manager-export', 'meta-capi-dispatch') then
    raise exception 'Unsupported RevOps worker';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));
  v_mode := nullif(trim(coalesce(p_mode, '')), '');
  if p_worker = 'google-data-manager-export' then
    if v_mode is not null and v_mode not in ('deliver', 'poll') then
      raise exception 'Unsupported Google Data Manager mode';
    end if;
  elsif v_mode is not null then
    raise exception 'Worker mode is only valid for Google Data Manager';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'REVOPS_INTERNAL_SECRET'
  limit 1;
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'Internal worker credential unavailable';
  end if;

  select trim(decrypted_secret) into v_project_url
  from vault.decrypted_secrets
  where name = 'REVOPS_PROJECT_URL'
  limit 1;
  if v_project_url is null or v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Environment-local RevOps project URL unavailable';
  end if;

  v_body := pg_catalog.jsonb_build_object('worker', p_worker, 'limit', v_limit);
  if v_mode is not null then
    v_body := v_body || pg_catalog.jsonb_build_object('mode', v_mode);
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/revops-dispatcher',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := v_body,
    timeout_milliseconds := 5000
  ) into v_request_id;

  if v_request_id is not null then
    insert into public.revops_dispatch_ledger (
      request_id, worker, mode, limit_val, dispatched_at, status
    ) values (
      v_request_id, p_worker, v_mode, v_limit, pg_catalog.clock_timestamp(), 'dispatched'
    );
  end if;

  return v_request_id;
end;
$$;

revoke all on function public.nvx_dispatch_revops_worker(text, integer, text) from public, anon, authenticated;
grant execute on function public.nvx_dispatch_revops_worker(text, integer, text) to service_role;

-- Wake the worker after commit for new events. nvx_try_dispatch_revops_worker()
-- deliberately fails open so a transport problem can never roll back a lead.
create or replace function public.nvx_meta_capi_outbox_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.nvx_try_dispatch_revops_worker('meta-capi-dispatch', 25, null);
  return new;
end;
$$;

revoke all on function public.nvx_meta_capi_outbox_wakeup() from public, anon, authenticated;
grant execute on function public.nvx_meta_capi_outbox_wakeup() to service_role;

drop trigger if exists trg_meta_capi_outbox_wakeup on public.meta_capi_outbox;
create trigger trg_meta_capi_outbox_wakeup
after insert on public.meta_capi_outbox
for each row execute function public.nvx_meta_capi_outbox_wakeup();

-- Preserve the existing atomic reconciliation contract and enqueue CAPI inside
-- the same transaction only for consented, non-QA website leads.
create or replace function public.finalize_web_capture_reconciliation(
  p_capture_id uuid,
  p_lead_id uuid,
  p_hubspot_contact_id bigint,
  p_owner_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture public.web_lead_captures%rowtype;
  v_lead public.leads%rowtype;
  v_google_count integer := 0;
begin
  select * into v_capture
  from public.web_lead_captures
  where id = p_capture_id
  for update;
  if not found then raise exception 'Capture not found'; end if;
  if v_capture.is_test_lead then raise exception 'QA capture cannot be reconciled'; end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and deleted_at is null
  for update;
  if not found then raise exception 'Lead not found'; end if;
  if coalesce(p_hubspot_contact_id, v_lead.hubspot_contact_id) is null then
    raise exception 'HubSpot contact ID is required for reconciliation';
  end if;
  if v_lead.hubspot_contact_id is distinct from p_hubspot_contact_id then
    raise exception 'HubSpot contact mismatch';
  end if;
  if v_capture.applied_lead_id is not null and v_capture.applied_lead_id <> p_lead_id then
    raise exception 'Capture already applied to another lead';
  end if;

  if v_capture.marketing_consent and exists (
    select 1
    from public.google_click_attributions g
    where g.nvx_lead_id = v_capture.nvx_lead_id
      and g.applied_lead_id is not null
      and g.applied_lead_id <> p_lead_id
  ) then
    raise exception 'Google attribution lineage conflict';
  end if;

  update public.web_lead_captures
  set applied_lead_id = p_lead_id,
      applied_at = coalesce(applied_at, pg_catalog.now()),
      reconciliation_status = 'reconciled',
      reconciliation_error = null,
      reconciled_at = coalesce(reconciled_at, pg_catalog.now()),
      last_reconciliation_attempt_at = pg_catalog.now(),
      last_seen_at = pg_catalog.now()
  where id = p_capture_id;

  if v_capture.marketing_consent then
    update public.google_click_attributions
    set applied_lead_id = p_lead_id,
        applied_at = coalesce(applied_at, pg_catalog.now()),
        reconciliation_status = 'reconciled',
        reconciliation_error = null,
        last_reconciliation_attempt_at = pg_catalog.now()
    where nvx_lead_id = v_capture.nvx_lead_id
      and coalesce(is_test_lead, false) = false
      and (applied_lead_id is null or applied_lead_id = p_lead_id);
    get diagnostics v_google_count = row_count;
  end if;

  insert into public.hubspot_deal_projections (
    lead_id, hubspot_contact_id, owner_id, projection_status, updated_at
  ) values (
    p_lead_id, p_hubspot_contact_id, nullif(trim(p_owner_id), ''), 'pending', pg_catalog.now()
  )
  on conflict (lead_id) do update
  set hubspot_contact_id = excluded.hubspot_contact_id,
      owner_id = coalesce(excluded.owner_id, public.hubspot_deal_projections.owner_id),
      projection_status = case
        when public.hubspot_deal_projections.projection_status = 'suppressed' then 'suppressed'
        else 'pending'
      end,
      last_error = null,
      updated_at = pg_catalog.now();

  if v_capture.marketing_consent and v_google_count > 0 then
    perform public.queue_google_data_manager_event(
      p_lead_id,
      'lead',
      coalesce(v_capture.captured_at, pg_catalog.now()),
      null,
      'lead:' || p_lead_id::text
    );
  end if;

  if v_capture.marketing_consent and coalesce(p_hubspot_contact_id, v_lead.hubspot_contact_id) is not null then
    insert into public.meta_capi_outbox (lead_id, event_name, event_id)
    values (p_lead_id, 'Lead', 'lead:' || v_capture.nvx_lead_id::text)
    on conflict (lead_id, event_name) do nothing;
  end if;

  return p_lead_id;
end;
$$;

revoke all on function public.finalize_web_capture_reconciliation(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.finalize_web_capture_reconciliation(uuid, uuid, bigint, text)
  to service_role;

-- Three-times-daily fallback matches the current reduced RevOps cron posture;
-- normal events are woken immediately by the outbox insert trigger above.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'nvx-meta-capi-dispatch'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-meta-capi-dispatch',
  '20 4,12,20 * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('meta-capi-dispatch', 50, null)
    where exists (
      select 1
      from public.meta_capi_outbox
      where attempts < 8
        and (
          (status in ('pending', 'failed') and next_attempt_at <= now())
          or (status = 'processing' and last_attempt_at < now() - interval '15 minutes')
        )
      limit 1
    );
  $cron$
);
