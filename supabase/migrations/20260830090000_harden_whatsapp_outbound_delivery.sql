-- NUVANX WhatsApp outbound hardening.
-- Creates an idempotent request ledger, atomic rate limiting, and provider-status reconciliation.
-- No message body is persisted: only a SHA-256 fingerprint and provider metadata.

create table if not exists public.whatsapp_send_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  user_id uuid not null,
  lead_id uuid not null,
  normalized_phone text not null,
  idempotency_key text not null,
  message_sha256 text not null,
  status text not null default 'reserved',
  provider_message_id text,
  provider_http_status integer,
  provider_error_code text,
  provider_error_message text,
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint whatsapp_send_requests_status_check check (
    status in ('reserved', 'accepted', 'sent', 'delivered', 'read', 'failed')
  ),
  constraint whatsapp_send_requests_idempotency_key_check check (
    idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  constraint whatsapp_send_requests_message_sha_check check (
    message_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create unique index if not exists whatsapp_send_requests_clinic_idempotency_uidx
  on public.whatsapp_send_requests (clinic_id, idempotency_key);

create unique index if not exists whatsapp_send_requests_provider_message_uidx
  on public.whatsapp_send_requests (provider_message_id)
  where provider_message_id is not null;

create index if not exists whatsapp_send_requests_lead_requested_idx
  on public.whatsapp_send_requests (lead_id, requested_at desc);

create index if not exists whatsapp_send_requests_user_requested_idx
  on public.whatsapp_send_requests (user_id, requested_at desc);

create index if not exists whatsapp_send_requests_clinic_requested_idx
  on public.whatsapp_send_requests (clinic_id, requested_at desc);

alter table public.whatsapp_send_requests enable row level security;

revoke all on table public.whatsapp_send_requests from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_send_requests to service_role;

drop policy if exists whatsapp_send_requests_service_role_all on public.whatsapp_send_requests;
create policy whatsapp_send_requests_service_role_all
  on public.whatsapp_send_requests
  for all
  to service_role
  using (true)
  with check (true);

-- Configurable per-clinic limits. When no row exists the RPC uses conservative defaults.
create table if not exists public.whatsapp_rate_limit_config (
  clinic_id uuid primary key,
  max_per_lead_10m integer not null default 3 check (max_per_lead_10m between 1 and 100),
  max_per_lead_24h integer not null default 12 check (max_per_lead_24h between 1 and 500),
  max_per_user_1m integer not null default 10 check (max_per_user_1m between 1 and 500),
  max_per_clinic_1m integer not null default 30 check (max_per_clinic_1m between 1 and 2000),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_rate_limit_config enable row level security;
revoke all on table public.whatsapp_rate_limit_config from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_rate_limit_config to service_role;

drop policy if exists whatsapp_rate_limit_config_service_role_all on public.whatsapp_rate_limit_config;
create policy whatsapp_rate_limit_config_service_role_all
  on public.whatsapp_rate_limit_config
  for all
  to service_role
  using (true)
  with check (true);

-- Provider message ids are the durable correlation key for delivery webhooks.
create unique index if not exists whatsapp_conversations_wa_message_id_uidx
  on public.whatsapp_conversations (wa_message_id)
  where wa_message_id is not null;

-- Delivery webhook retries are idempotent at the event ledger boundary.
create unique index if not exists lead_events_whatsapp_message_status_uidx
  on public.lead_events (lead_id, event_type, ((raw_payload ->> 'message_id')))
  where source_platform = 'whatsapp'
    and raw_payload ? 'message_id';

create or replace function public.nvx_prepare_whatsapp_send(
  p_user_id uuid,
  p_lead_id uuid,
  p_normalized_phone text,
  p_idempotency_key text,
  p_message_sha256 text
)
returns table (
  request_id uuid,
  clinic_id uuid,
  decision text,
  request_status text,
  provider_message_id text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_lead_phone_digits text;
  v_requested_phone_digits text;
  v_existing public.whatsapp_send_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_max_lead_10m integer := 3;
  v_max_lead_24h integer := 12;
  v_max_user_1m integer := 10;
  v_max_clinic_1m integer := 30;
  v_request_id uuid;
  v_reason text;
  v_retry integer;
begin
  if p_user_id is null or p_lead_id is null then
    raise exception 'user_id_and_lead_id_required' using errcode = '22023';
  end if;
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  if coalesce(p_message_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_message_fingerprint' using errcode = '22023';
  end if;

  select u.clinic_id,
         regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')
    into v_clinic_id, v_lead_phone_digits
  from public.leads l
  join public.users u on u.id = l.user_id
  where l.id = p_lead_id
    and l.user_id = p_user_id
    and l.deleted_at is null
  limit 1;

  if v_clinic_id is null then
    raise exception 'lead_not_owned' using errcode = '42501';
  end if;

  v_requested_phone_digits := regexp_replace(coalesce(p_normalized_phone, ''), '[^0-9]', '', 'g');
  if v_lead_phone_digits = '' or v_requested_phone_digits = '' or v_lead_phone_digits <> v_requested_phone_digits then
    raise exception 'recipient_does_not_match_lead_phone' using errcode = '22023';
  end if;

  -- Serialize competing sends for the same user/lead so limits and idempotency are atomic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nvx-whatsapp:' || p_user_id::text || ':' || p_lead_id::text, 0)
  );

  select *
    into v_existing
  from public.whatsapp_send_requests r
  where r.clinic_id = v_clinic_id
    and r.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.lead_id <> p_lead_id
       or v_existing.normalized_phone <> p_normalized_phone
       or v_existing.message_sha256 <> p_message_sha256 then
      raise exception 'idempotency_key_conflict' using errcode = '23505';
    end if;

    return query
      select v_existing.id,
             v_existing.clinic_id,
             'duplicate'::text,
             v_existing.status,
             v_existing.provider_message_id,
             0;
    return;
  end if;

  select
    c.max_per_lead_10m,
    c.max_per_lead_24h,
    c.max_per_user_1m,
    c.max_per_clinic_1m
  into
    v_max_lead_10m,
    v_max_lead_24h,
    v_max_user_1m,
    v_max_clinic_1m
  from public.whatsapp_rate_limit_config c
  where c.clinic_id = v_clinic_id;

  v_max_lead_10m := coalesce(v_max_lead_10m, 3);
  v_max_lead_24h := coalesce(v_max_lead_24h, 12);
  v_max_user_1m := coalesce(v_max_user_1m, 10);
  v_max_clinic_1m := coalesce(v_max_clinic_1m, 30);

  select count(*)::integer into v_count
  from public.whatsapp_send_requests r
  where r.lead_id = p_lead_id
    and r.requested_at >= v_now - interval '10 minutes';
  if v_count >= v_max_lead_10m then
    v_reason := 'lead_10m';
    v_retry := 600;
  end if;

  if v_reason is null then
    select count(*)::integer into v_count
    from public.whatsapp_send_requests r
    where r.lead_id = p_lead_id
      and r.requested_at >= v_now - interval '24 hours';
    if v_count >= v_max_lead_24h then
      v_reason := 'lead_24h';
      v_retry := 3600;
    end if;
  end if;

  if v_reason is null then
    select count(*)::integer into v_count
    from public.whatsapp_send_requests r
    where r.user_id = p_user_id
      and r.requested_at >= v_now - interval '1 minute';
    if v_count >= v_max_user_1m then
      v_reason := 'user_1m';
      v_retry := 60;
    end if;
  end if;

  if v_reason is null then
    select count(*)::integer into v_count
    from public.whatsapp_send_requests r
    where r.clinic_id = v_clinic_id
      and r.requested_at >= v_now - interval '1 minute';
    if v_count >= v_max_clinic_1m then
      v_reason := 'clinic_1m';
      v_retry := 60;
    end if;
  end if;

  if v_reason is not null then
    insert into public.lead_events (
      lead_id,
      source_platform,
      source_channel,
      channel_label,
      event_type,
      event_created_at,
      captured_at,
      resolution_status,
      raw_payload
    ) values (
      p_lead_id,
      'whatsapp',
      'direct',
      'WhatsApp',
      'whatsapp_rate_limited',
      v_now,
      v_now,
      'suppressed',
      jsonb_build_object(
        'reason', v_reason,
        'retry_after_seconds', v_retry,
        'actor', 'human_authenticated'
      )
    );

    return query
      select null::uuid,
             v_clinic_id,
             'rate_limited'::text,
             'rate_limited'::text,
             null::text,
             v_retry;
    return;
  end if;

  insert into public.whatsapp_send_requests (
    clinic_id,
    user_id,
    lead_id,
    normalized_phone,
    idempotency_key,
    message_sha256,
    status,
    requested_at,
    updated_at
  ) values (
    v_clinic_id,
    p_user_id,
    p_lead_id,
    p_normalized_phone,
    p_idempotency_key,
    p_message_sha256,
    'reserved',
    v_now,
    v_now
  )
  returning id into v_request_id;

  insert into public.lead_events (
    lead_id,
    source_platform,
    source_channel,
    channel_label,
    event_type,
    event_created_at,
    captured_at,
    resolution_status,
    raw_payload
  ) values (
    p_lead_id,
    'whatsapp',
    'direct',
    'WhatsApp',
    'whatsapp_message_requested',
    v_now,
    v_now,
    'pending',
    jsonb_build_object(
      'request_id', v_request_id,
      'actor', 'human_authenticated'
    )
  );

  return query
    select v_request_id,
           v_clinic_id,
           'reserved'::text,
           'reserved'::text,
           null::text,
           0;
end;
$$;

revoke all on function public.nvx_prepare_whatsapp_send(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.nvx_prepare_whatsapp_send(uuid, uuid, text, text, text) to service_role;

create or replace function public.nvx_finalize_whatsapp_send(
  p_request_id uuid,
  p_user_id uuid,
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
  v_request public.whatsapp_send_requests%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_status not in ('accepted', 'failed') then
    raise exception 'invalid_finalize_status' using errcode = '22023';
  end if;

  select * into v_request
  from public.whatsapp_send_requests r
  where r.id = p_request_id
    and r.user_id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  update public.whatsapp_send_requests r
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, r.provider_message_id),
      provider_http_status = p_provider_http_status,
      provider_error_code = p_provider_error_code,
      provider_error_message = left(p_provider_error_message, 500),
      accepted_at = case when p_status = 'accepted' then coalesce(r.accepted_at, v_now) else r.accepted_at end,
      failed_at = case when p_status = 'failed' then coalesce(r.failed_at, v_now) else r.failed_at end,
      updated_at = v_now
  where r.id = p_request_id;

  if p_status = 'accepted' and coalesce(p_provider_message_id, '') <> '' then
    insert into public.whatsapp_conversations (
      clinic_id,
      lead_id,
      phone,
      direction,
      message_type,
      sent_at,
      wa_message_id,
      conversation_status
    ) values (
      v_request.clinic_id,
      v_request.lead_id,
      v_request.normalized_phone,
      'outbound',
      'text',
      v_now,
      p_provider_message_id,
      'accepted'
    )
    on conflict (wa_message_id) where wa_message_id is not null
    do update set
      sent_at = coalesce(public.whatsapp_conversations.sent_at, excluded.sent_at),
      conversation_status = excluded.conversation_status;

    insert into public.lead_events (
      lead_id,
      source_platform,
      source_channel,
      channel_label,
      event_type,
      event_created_at,
      captured_at,
      resolution_status,
      raw_payload
    ) values (
      v_request.lead_id,
      'whatsapp',
      'direct',
      'WhatsApp',
      'whatsapp_meta_accepted',
      v_now,
      v_now,
      'accepted',
      jsonb_build_object(
        'message_id', p_provider_message_id,
        'request_id', p_request_id,
        'actor', 'human_authenticated'
      )
    )
    on conflict do nothing;
  elsif p_status = 'failed' then
    insert into public.lead_events (
      lead_id,
      source_platform,
      source_channel,
      channel_label,
      event_type,
      event_created_at,
      captured_at,
      resolution_status,
      error_message,
      raw_payload
    ) values (
      v_request.lead_id,
      'whatsapp',
      'direct',
      'WhatsApp',
      'whatsapp_provider_failed',
      v_now,
      v_now,
      'failed',
      left(p_provider_error_message, 500),
      jsonb_build_object(
        'request_id', p_request_id,
        'provider_http_status', p_provider_http_status,
        'provider_error_code', p_provider_error_code
      )
    );
  end if;

  return true;
end;
$$;

revoke all on function public.nvx_finalize_whatsapp_send(uuid, uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.nvx_finalize_whatsapp_send(uuid, uuid, text, text, integer, text, text) to service_role;

create or replace function public.nvx_apply_whatsapp_status(
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
  v_request public.whatsapp_send_requests%rowtype;
  v_event_type text;
  v_resolution text;
  v_event_at timestamptz := coalesce(p_event_at, clock_timestamp());
begin
  if coalesce(p_provider_message_id, '') = '' then
    return false;
  end if;
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    return false;
  end if;

  select * into v_request
  from public.whatsapp_send_requests r
  where r.provider_message_id = p_provider_message_id
  for update;

  if not found then
    return false;
  end if;

  update public.whatsapp_send_requests r
  set status = case
        when p_status = 'failed' then 'failed'
        when p_status = 'read' then 'read'
        when p_status = 'delivered' and r.status <> 'read' then 'delivered'
        when p_status = 'sent' and r.status in ('reserved', 'accepted') then 'sent'
        else r.status
      end,
      sent_at = case when p_status = 'sent' then coalesce(r.sent_at, v_event_at) else r.sent_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(r.delivered_at, v_event_at) else r.delivered_at end,
      read_at = case when p_status = 'read' then coalesce(r.read_at, v_event_at) else r.read_at end,
      failed_at = case when p_status = 'failed' then coalesce(r.failed_at, v_event_at) else r.failed_at end,
      provider_error_code = case when p_status = 'failed' then p_error_code else r.provider_error_code end,
      provider_error_message = case when p_status = 'failed' then left(p_error_message, 500) else r.provider_error_message end,
      updated_at = clock_timestamp()
  where r.id = v_request.id;

  update public.whatsapp_conversations c
  set sent_at = case when p_status = 'sent' then coalesce(c.sent_at, v_event_at) else c.sent_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(c.delivered_at, v_event_at) else c.delivered_at end,
      read_at = case when p_status = 'read' then coalesce(c.read_at, v_event_at) else c.read_at end,
      conversation_status = p_status
  where c.wa_message_id = p_provider_message_id;

  v_event_type := 'whatsapp_' || p_status;
  v_resolution := case when p_status = 'failed' then 'failed' else p_status end;

  insert into public.lead_events (
    lead_id,
    source_platform,
    source_channel,
    channel_label,
    event_type,
    event_created_at,
    captured_at,
    resolution_status,
    error_message,
    raw_payload
  ) values (
    v_request.lead_id,
    'whatsapp',
    'delivery_status',
    'WhatsApp',
    v_event_type,
    v_event_at,
    clock_timestamp(),
    v_resolution,
    case when p_status = 'failed' then left(p_error_message, 500) else null end,
    jsonb_strip_nulls(jsonb_build_object(
      'message_id', p_provider_message_id,
      'request_id', v_request.id,
      'provider_error_code', p_error_code
    ))
  )
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.nvx_apply_whatsapp_status(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.nvx_apply_whatsapp_status(text, text, timestamptz, text, text) to service_role;
