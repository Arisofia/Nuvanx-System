-- Durable asynchronous WhatsApp delivery without persisting plaintext message bodies.
-- The browser-facing function encrypts the message before this transaction.
-- A service-role worker claims the ciphertext, decrypts it in memory, marks the
-- provider attempt as started (which irreversibly purges ciphertext), and then
-- performs at most one provider call for that claim.

create table if not exists public.whatsapp_outbound_payloads (
  request_id uuid primary key references public.whatsapp_send_requests(id) on delete cascade,
  ciphertext text,
  iv text,
  key_version text not null,
  state text not null default 'queued',
  claim_token uuid,
  claim_attempts integer not null default 0,
  claimed_at timestamptz,
  provider_attempt_started_at timestamptz,
  completed_at timestamptz,
  manual_review_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_outbound_payloads_state_check check (
    state in ('queued', 'claimed', 'sending', 'terminal', 'manual_review')
  ),
  constraint whatsapp_outbound_payloads_key_version_check check (
    key_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  constraint whatsapp_outbound_payloads_claim_attempts_check check (
    claim_attempts between 0 and 3
  ),
  constraint whatsapp_outbound_payloads_ciphertext_lifecycle_check check (
    (
      state in ('queued', 'claimed')
      and ciphertext is not null
      and iv is not null
      and length(ciphertext) between 16 and 16384
      and length(iv) between 12 and 128
    )
    or (
      state in ('sending', 'terminal', 'manual_review')
      and ciphertext is null
      and iv is null
    )
  )
);

create index if not exists whatsapp_outbound_payloads_claim_idx
  on public.whatsapp_outbound_payloads (state, expires_at, created_at)
  where state in ('queued', 'claimed', 'sending');

alter table public.whatsapp_outbound_payloads enable row level security;
revoke all on table public.whatsapp_outbound_payloads from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_outbound_payloads to service_role;

drop policy if exists whatsapp_outbound_payloads_service_role_all on public.whatsapp_outbound_payloads;
create policy whatsapp_outbound_payloads_service_role_all
  on public.whatsapp_outbound_payloads
  for all
  to service_role
  using (true)
  with check (true);

-- Atomic wrapper around the already-governed ownership/idempotency/rate-limit
-- reservation. The request ledger and encrypted payload commit together.
create or replace function public.nvx_prepare_whatsapp_send_async(
  p_user_id uuid,
  p_lead_id uuid,
  p_normalized_phone text,
  p_idempotency_key text,
  p_message_sha256 text,
  p_ciphertext text,
  p_iv text,
  p_key_version text
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
  v_request_id uuid;
  v_clinic_id uuid;
  v_decision text;
  v_request_status text;
  v_provider_message_id text;
  v_retry_after_seconds integer;
begin
  if coalesce(p_ciphertext, '') = '' or length(p_ciphertext) > 16384 then
    raise exception 'invalid_encrypted_payload' using errcode = '22023';
  end if;
  if coalesce(p_iv, '') = '' or length(p_iv) > 128 then
    raise exception 'invalid_encryption_iv' using errcode = '22023';
  end if;
  if coalesce(p_key_version, '') !~ '^[A-Za-z0-9._-]{1,64}$' then
    raise exception 'invalid_encryption_key_version' using errcode = '22023';
  end if;

  select d.request_id,
         d.clinic_id,
         d.decision,
         d.request_status,
         d.provider_message_id,
         d.retry_after_seconds
    into v_request_id,
         v_clinic_id,
         v_decision,
         v_request_status,
         v_provider_message_id,
         v_retry_after_seconds
  from public.nvx_prepare_whatsapp_send(
    p_user_id,
    p_lead_id,
    p_normalized_phone,
    p_idempotency_key,
    p_message_sha256
  ) d;

  if v_decision = 'reserved' and v_request_id is not null then
    insert into public.whatsapp_outbound_payloads (
      request_id,
      ciphertext,
      iv,
      key_version,
      state,
      expires_at,
      created_at,
      updated_at
    ) values (
      v_request_id,
      p_ciphertext,
      p_iv,
      p_key_version,
      'queued',
      pg_catalog.clock_timestamp() + interval '1 hour',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    );
  end if;

  return query
    select v_request_id,
           v_clinic_id,
           v_decision,
           v_request_status,
           v_provider_message_id,
           coalesce(v_retry_after_seconds, 0);
end;
$$;

revoke all on function public.nvx_prepare_whatsapp_send_async(uuid,uuid,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.nvx_prepare_whatsapp_send_async(uuid,uuid,text,text,text,text,text,text)
  to service_role;

-- Reconcile only states for which automatic action is provably safe:
-- * a stale CLAIMED row has not started a provider attempt, so it may be reclaimed;
-- * a stale SENDING row may already have reached Meta, so it becomes UNKNOWN/manual review;
-- * an expired queued payload becomes a terminal local failure without a provider call.
create or replace function public.nvx_claim_whatsapp_outbound_payload(
  p_limit integer default 25
)
returns table (
  request_id uuid,
  user_id uuid,
  lead_id uuid,
  normalized_phone text,
  message_sha256 text,
  ciphertext text,
  iv text,
  key_version text,
  claim_token uuid,
  claim_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_row record;
  v_claim_token uuid;
begin
  -- Provider attempt already marked as started: never replay automatically.
  update public.whatsapp_send_requests r
  set status = 'unknown',
      provider_error_code = coalesce(r.provider_error_code, 'worker_interrupted_after_attempt_start'),
      provider_error_message = coalesce(r.provider_error_message, 'Worker outcome requires manual review; automatic resend is blocked'),
      unknown_at = coalesce(r.unknown_at, v_now),
      updated_at = v_now
  where r.status = 'reserved'
    and exists (
      select 1
      from public.whatsapp_outbound_payloads p
      where p.request_id = r.id
        and p.state = 'sending'
        and p.provider_attempt_started_at < v_now - interval '2 minutes'
    );

  update public.whatsapp_outbound_payloads p
  set state = 'manual_review',
      ciphertext = null,
      iv = null,
      manual_review_at = coalesce(p.manual_review_at, v_now),
      updated_at = v_now
  where p.state = 'sending'
    and p.provider_attempt_started_at < v_now - interval '2 minutes';

  -- A worker that died before provider-attempt start may safely release its claim.
  update public.whatsapp_outbound_payloads p
  set state = 'queued',
      claim_token = null,
      claimed_at = null,
      updated_at = v_now
  where p.state = 'claimed'
    and p.claimed_at < v_now - interval '2 minutes'
    and p.claim_attempts < 3
    and p.expires_at > v_now;

  -- Too many pre-provider claim failures are manual review, not an infinite retry loop.
  update public.whatsapp_send_requests r
  set status = 'unknown',
      provider_error_code = coalesce(r.provider_error_code, 'worker_claim_exhausted'),
      provider_error_message = coalesce(r.provider_error_message, 'Outbound worker claim attempts were exhausted before provider delivery'),
      unknown_at = coalesce(r.unknown_at, v_now),
      updated_at = v_now
  where r.status = 'reserved'
    and exists (
      select 1
      from public.whatsapp_outbound_payloads p
      where p.request_id = r.id
        and p.state = 'claimed'
        and p.claimed_at < v_now - interval '2 minutes'
        and p.claim_attempts >= 3
    );

  update public.whatsapp_outbound_payloads p
  set state = 'manual_review',
      ciphertext = null,
      iv = null,
      manual_review_at = coalesce(p.manual_review_at, v_now),
      updated_at = v_now
  where p.state = 'claimed'
    and p.claimed_at < v_now - interval '2 minutes'
    and p.claim_attempts >= 3;

  -- Expired encrypted payloads never reach Meta.
  update public.whatsapp_send_requests r
  set status = 'failed',
      provider_error_code = coalesce(r.provider_error_code, 'queue_expired'),
      provider_error_message = coalesce(r.provider_error_message, 'Encrypted outbound payload expired before provider delivery'),
      failed_at = coalesce(r.failed_at, v_now),
      updated_at = v_now
  where r.status = 'reserved'
    and exists (
      select 1
      from public.whatsapp_outbound_payloads p
      where p.request_id = r.id
        and p.state in ('queued', 'claimed')
        and p.expires_at <= v_now
    );

  update public.whatsapp_outbound_payloads p
  set state = 'terminal',
      ciphertext = null,
      iv = null,
      completed_at = coalesce(p.completed_at, v_now),
      updated_at = v_now
  where p.state in ('queued', 'claimed')
    and p.expires_at <= v_now;

  for v_row in
    select p.request_id,
           r.user_id,
           r.lead_id,
           r.normalized_phone,
           r.message_sha256,
           p.ciphertext,
           p.iv,
           p.key_version,
           p.claim_attempts
    from public.whatsapp_outbound_payloads p
    join public.whatsapp_send_requests r on r.id = p.request_id
    where p.state = 'queued'
      and p.expires_at > v_now
      and r.status = 'reserved'
    order by p.created_at, p.request_id
    for update of p skip locked
    limit v_limit
  loop
    v_claim_token := gen_random_uuid();

    update public.whatsapp_outbound_payloads p
    set state = 'claimed',
        claim_token = v_claim_token,
        claim_attempts = p.claim_attempts + 1,
        claimed_at = v_now,
        updated_at = v_now
    where p.request_id = v_row.request_id
      and p.state = 'queued';

    return query
      select v_row.request_id,
             v_row.user_id,
             v_row.lead_id,
             v_row.normalized_phone,
             v_row.message_sha256,
             v_row.ciphertext,
             v_row.iv,
             v_row.key_version,
             v_claim_token,
             (v_row.claim_attempts + 1)::integer;
  end loop;
end;
$$;

revoke all on function public.nvx_claim_whatsapp_outbound_payload(integer)
  from public, anon, authenticated;
grant execute on function public.nvx_claim_whatsapp_outbound_payload(integer) to service_role;

-- This is the irreversible provider-attempt boundary. Ciphertext is destroyed
-- before the HTTP call. A crash after this point cannot cause an automatic resend.
create or replace function public.nvx_mark_whatsapp_payload_sending(
  p_request_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.whatsapp_outbound_payloads p
  set state = 'sending',
      ciphertext = null,
      iv = null,
      provider_attempt_started_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where p.request_id = p_request_id
    and p.state = 'claimed'
    and p.claim_token = p_claim_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.nvx_mark_whatsapp_payload_sending(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.nvx_mark_whatsapp_payload_sending(uuid,uuid) to service_role;

create or replace function public.nvx_finish_whatsapp_outbound_payload(
  p_request_id uuid,
  p_claim_token uuid,
  p_manual_review boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.whatsapp_outbound_payloads p
  set state = case when p_manual_review then 'manual_review' else 'terminal' end,
      ciphertext = null,
      iv = null,
      completed_at = case when p_manual_review then p.completed_at else coalesce(p.completed_at, v_now) end,
      manual_review_at = case when p_manual_review then coalesce(p.manual_review_at, v_now) else p.manual_review_at end,
      updated_at = v_now
  where p.request_id = p_request_id
    and p.claim_token = p_claim_token
    and p.state in ('claimed', 'sending');

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.nvx_finish_whatsapp_outbound_payload(uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.nvx_finish_whatsapp_outbound_payload(uuid,uuid,boolean) to service_role;

create or replace function public.nvx_get_whatsapp_outbound_queue_health()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'queued', count(*) filter (where state = 'queued'),
    'claimed', count(*) filter (where state = 'claimed'),
    'sending', count(*) filter (where state = 'sending'),
    'manualReview', count(*) filter (where state = 'manual_review'),
    'terminal', count(*) filter (where state = 'terminal'),
    'oldestQueuedAt', min(created_at) filter (where state = 'queued'),
    'oldestClaimedAt', min(claimed_at) filter (where state = 'claimed'),
    'oldestSendingAt', min(provider_attempt_started_at) filter (where state = 'sending'),
    'generatedAt', pg_catalog.clock_timestamp()
  )
  from public.whatsapp_outbound_payloads;
$$;

revoke all on function public.nvx_get_whatsapp_outbound_queue_health()
  from public, anon, authenticated;
grant execute on function public.nvx_get_whatsapp_outbound_queue_health() to service_role;

-- Extend the existing governed dispatcher with the WhatsApp async worker.
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
  if p_worker not in ('web-lead-reconcile', 'deal-factory', 'google-data-manager-export', 'meta-capi-dispatch', 'whatsapp-outbound-worker') then
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

revoke all on function public.nvx_dispatch_revops_worker(text,integer,text)
  from public, anon, authenticated;
grant execute on function public.nvx_dispatch_revops_worker(text,integer,text) to service_role;

create or replace function public.nvx_wake_whatsapp_outbound_on_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'queued'
     and (tg_op = 'INSERT' or old.state is distinct from 'queued') then
    perform public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 25, null);
  end if;
  return new;
end;
$$;

revoke all on function public.nvx_wake_whatsapp_outbound_on_queue() from public, anon, authenticated;

drop trigger if exists trg_nvx_wake_whatsapp_outbound on public.whatsapp_outbound_payloads;
create trigger trg_nvx_wake_whatsapp_outbound
after insert or update of state on public.whatsapp_outbound_payloads
for each row execute function public.nvx_wake_whatsapp_outbound_on_queue();

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'nvx-whatsapp-outbound-worker'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-whatsapp-outbound-worker',
  '* * * * *',
  $cron$select public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 25, null);$cron$
);
