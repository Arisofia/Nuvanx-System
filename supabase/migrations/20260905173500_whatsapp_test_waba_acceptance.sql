-- #362: Isolated Meta Test WABA provider acceptance.
--
-- This lane is deliberately separate from patient delivery:
--   * it never references leads, public.users, or whatsapp_rate_limit_config;
--   * it stores only hashes of the controlled test recipient/message;
--   * idempotency is owned transactionally in Postgres;
--   * `sending` is persisted before the irreversible provider attempt;
--   * a duplicate/stale `sending` run is never automatically resent;
--   * signed Meta webhook statuses reconcile by provider_message_id.

create table if not exists public.whatsapp_provider_acceptance_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  recipient_sha256 text not null,
  message_sha256 text not null,
  status text not null default 'reserved',
  provider_message_id text,
  provider_http_status integer,
  provider_error_code text,
  provider_error_message text,
  requested_at timestamptz not null default pg_catalog.now(),
  provider_attempt_started_at timestamptz,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  unknown_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint whatsapp_provider_acceptance_runs_status_check check (
    status in ('reserved', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'unknown')
  ),
  constraint whatsapp_provider_acceptance_runs_idempotency_check check (
    idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  constraint whatsapp_provider_acceptance_runs_recipient_sha_check check (
    recipient_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint whatsapp_provider_acceptance_runs_message_sha_check check (
    message_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create unique index if not exists whatsapp_provider_acceptance_runs_idempotency_uidx
  on public.whatsapp_provider_acceptance_runs (idempotency_key);

create unique index if not exists whatsapp_provider_acceptance_runs_provider_message_uidx
  on public.whatsapp_provider_acceptance_runs (provider_message_id)
  where provider_message_id is not null;

alter table public.whatsapp_provider_acceptance_runs enable row level security;
revoke all on table public.whatsapp_provider_acceptance_runs from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_provider_acceptance_runs to service_role;

drop policy if exists whatsapp_provider_acceptance_runs_service_role_all
  on public.whatsapp_provider_acceptance_runs;
create policy whatsapp_provider_acceptance_runs_service_role_all
  on public.whatsapp_provider_acceptance_runs
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.nvx_prepare_whatsapp_provider_acceptance(
  p_idempotency_key text,
  p_recipient_sha256 text,
  p_message_sha256 text
)
returns table (
  run_id uuid,
  decision text,
  run_status text,
  provider_message_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.whatsapp_provider_acceptance_runs%rowtype;
  v_run_id uuid;
  v_recent_count integer;
begin
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'invalid_acceptance_idempotency_key' using errcode = '22023';
  end if;
  if coalesce(p_recipient_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_acceptance_recipient_fingerprint' using errcode = '22023';
  end if;
  if coalesce(p_message_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_acceptance_message_fingerprint' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nvx-whatsapp-provider-acceptance:' || p_idempotency_key, 0)
  );

  select * into v_existing
  from public.whatsapp_provider_acceptance_runs r
  where r.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.recipient_sha256 <> p_recipient_sha256
       or v_existing.message_sha256 <> p_message_sha256 then
      raise exception 'acceptance_idempotency_key_conflict' using errcode = '23505';
    end if;

    return query
      select v_existing.id,
             'duplicate'::text,
             v_existing.status,
             v_existing.provider_message_id;
    return;
  end if;

  -- Acceptance is intentionally low-frequency even though it cannot reach a patient.
  select count(*)::integer into v_recent_count
  from public.whatsapp_provider_acceptance_runs r
  where r.requested_at >= pg_catalog.clock_timestamp() - interval '1 hour';

  if v_recent_count >= 3 then
    raise exception 'whatsapp_provider_acceptance_hourly_limit' using errcode = '55000';
  end if;

  insert into public.whatsapp_provider_acceptance_runs (
    idempotency_key,
    recipient_sha256,
    message_sha256,
    status,
    requested_at,
    updated_at
  ) values (
    p_idempotency_key,
    p_recipient_sha256,
    p_message_sha256,
    'reserved',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ) returning id into v_run_id;

  return query select v_run_id, 'reserved'::text, 'reserved'::text, null::text;
end;
$$;

revoke all on function public.nvx_prepare_whatsapp_provider_acceptance(text,text,text)
  from public, anon, authenticated;
grant execute on function public.nvx_prepare_whatsapp_provider_acceptance(text,text,text)
  to service_role;

create or replace function public.nvx_mark_whatsapp_provider_acceptance_sending(
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_provider_acceptance_runs r
  set status = 'sending',
      provider_attempt_started_at = coalesce(r.provider_attempt_started_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where r.id = p_run_id
    and r.status = 'reserved';

  return found;
end;
$$;

revoke all on function public.nvx_mark_whatsapp_provider_acceptance_sending(uuid)
  from public, anon, authenticated;
grant execute on function public.nvx_mark_whatsapp_provider_acceptance_sending(uuid)
  to service_role;

create or replace function public.nvx_finalize_whatsapp_provider_acceptance(
  p_run_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_provider_http_status integer default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.whatsapp_provider_acceptance_runs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_status not in ('accepted', 'failed', 'unknown') then
    raise exception 'invalid_acceptance_finalize_status' using errcode = '22023';
  end if;

  select * into v_run
  from public.whatsapp_provider_acceptance_runs r
  where r.id = p_run_id
  for update;

  if not found then return false; end if;

  if v_run.status in ('accepted', 'sent', 'delivered', 'read')
     and p_status in ('failed', 'unknown') then
    return true;
  end if;

  if v_run.status not in ('sending', 'accepted', 'sent', 'delivered', 'read') then
    if v_run.status <> p_status then return false; end if;
  end if;

  if coalesce(p_provider_message_id, '') <> '' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('nvx-whatsapp-provider:' || p_provider_message_id, 0)
    );
  end if;

  update public.whatsapp_provider_acceptance_runs r
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, r.provider_message_id),
      provider_http_status = coalesce(p_provider_http_status, r.provider_http_status),
      provider_error_code = coalesce(p_provider_error_code, r.provider_error_code),
      provider_error_message = coalesce(pg_catalog.left(p_provider_error_message, 500), r.provider_error_message),
      accepted_at = case when p_status = 'accepted' then coalesce(r.accepted_at, v_now) else r.accepted_at end,
      failed_at = case when p_status = 'failed' then coalesce(r.failed_at, v_now) else r.failed_at end,
      unknown_at = case when p_status = 'unknown' then coalesce(r.unknown_at, v_now) else r.unknown_at end,
      updated_at = v_now
  where r.id = p_run_id;

  return true;
end;
$$;

revoke all on function public.nvx_finalize_whatsapp_provider_acceptance(uuid,text,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.nvx_finalize_whatsapp_provider_acceptance(uuid,text,text,integer,text,text)
  to service_role;

create or replace function public.nvx_apply_whatsapp_provider_acceptance_status(
  p_provider_message_id text,
  p_status text,
  p_event_at timestamptz,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.whatsapp_provider_acceptance_runs%rowtype;
  v_event_at timestamptz := coalesce(p_event_at, pg_catalog.clock_timestamp());
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'invalid_acceptance_provider_status' using errcode = '22023';
  end if;

  select * into v_run
  from public.whatsapp_provider_acceptance_runs r
  where r.provider_message_id = p_provider_message_id
  for update;

  if not found then return false; end if;

  -- Delivery status is monotonic. Late lower-rank webhooks are idempotent no-ops.
  if v_run.status = 'read'
     or (v_run.status = 'delivered' and p_status in ('sent', 'accepted'))
     or (v_run.status = 'sent' and p_status = 'accepted') then
    return true;
  end if;

  if p_status = 'failed' and v_run.status in ('sent', 'delivered', 'read') then
    return true;
  end if;

  update public.whatsapp_provider_acceptance_runs r
  set status = p_status,
      sent_at = case when p_status = 'sent' then coalesce(r.sent_at, v_event_at) else r.sent_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(r.delivered_at, v_event_at) else r.delivered_at end,
      read_at = case when p_status = 'read' then coalesce(r.read_at, v_event_at) else r.read_at end,
      failed_at = case when p_status = 'failed' then coalesce(r.failed_at, v_event_at) else r.failed_at end,
      provider_error_code = coalesce(p_error_code, r.provider_error_code),
      provider_error_message = coalesce(pg_catalog.left(p_error_message, 500), r.provider_error_message),
      updated_at = pg_catalog.clock_timestamp()
  where r.id = v_run.id;

  return true;
end;
$$;

revoke all on function public.nvx_apply_whatsapp_provider_acceptance_status(text,text,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.nvx_apply_whatsapp_provider_acceptance_status(text,text,timestamptz,text,text)
  to service_role;
