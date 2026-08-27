-- Make asynchronous pg_net delivery outcomes observable without making business
-- transactions wait on HTTP. The dispatcher records only request metadata.
-- Reconciliation and fail-closed health run in separate cron transactions so a
-- health exception can never roll back durable delivery evidence.

create table if not exists public.revops_dispatch_attempts (
  request_id bigint primary key,
  worker text not null check (worker in ('web-lead-reconcile','deal-factory','google-data-manager-export')),
  mode text null check (mode is null or mode in ('deliver','poll')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz null,
  outcome text not null default 'pending' check (outcome in ('pending','succeeded','failed','timed_out','missing_response')),
  response_status integer null,
  timed_out boolean not null default false,
  error_message text null,
  updated_at timestamptz not null default now()
);

alter table public.revops_dispatch_attempts enable row level security;
revoke all on table public.revops_dispatch_attempts from public, anon, authenticated;
grant select on table public.revops_dispatch_attempts to service_role;

create index if not exists revops_dispatch_attempts_outcome_requested_idx
  on public.revops_dispatch_attempts (outcome, requested_at desc);

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
  if p_worker not in ('web-lead-reconcile','deal-factory','google-data-manager-export') then
    raise exception 'Unsupported RevOps worker';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));
  v_mode := nullif(trim(coalesce(p_mode, '')), '');
  if p_worker = 'google-data-manager-export' then
    if v_mode is not null and v_mode not in ('deliver','poll') then
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

  insert into public.revops_dispatch_attempts (
    request_id,
    worker,
    mode,
    requested_at,
    outcome
  ) values (
    v_request_id,
    p_worker,
    v_mode,
    now(),
    'pending'
  )
  on conflict (request_id) do nothing;

  return v_request_id;
end;
$$;

revoke all on function public.nvx_dispatch_revops_worker(text,integer,text) from public, anon, authenticated;
grant execute on function public.nvx_dispatch_revops_worker(text,integer,text) to service_role;

create or replace function public.nvx_reconcile_revops_dispatch_attempts()
returns table (
  pending_count bigint,
  succeeded_count bigint,
  failed_count bigint,
  timed_out_count bigint,
  missing_response_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.revops_dispatch_attempts as a
  set
    responded_at = coalesce(r.created, now()),
    response_status = r.status_code,
    timed_out = coalesce(r.timed_out, false),
    error_message = case
      when r.error_msg is null then null
      else left(r.error_msg, 240)
    end,
    outcome = case
      when coalesce(r.timed_out, false) then 'timed_out'
      when r.error_msg is not null then 'failed'
      when r.status_code between 200 and 299 then 'succeeded'
      else 'failed'
    end,
    updated_at = now()
  from net._http_response as r
  where a.request_id = r.id
    and a.outcome = 'pending';

  update public.revops_dispatch_attempts
  set
    outcome = 'missing_response',
    updated_at = now()
  where outcome = 'pending'
    and requested_at < now() - interval '10 minutes';

  delete from public.revops_dispatch_attempts
  where outcome <> 'pending'
    and requested_at < now() - interval '30 days';

  return query
  select
    count(*) filter (where a.outcome = 'pending')::bigint,
    count(*) filter (where a.outcome = 'succeeded')::bigint,
    count(*) filter (where a.outcome = 'failed')::bigint,
    count(*) filter (where a.outcome = 'timed_out')::bigint,
    count(*) filter (where a.outcome = 'missing_response')::bigint
  from public.revops_dispatch_attempts as a
  where a.requested_at >= now() - interval '15 minutes';
end;
$$;

revoke all on function public.nvx_reconcile_revops_dispatch_attempts() from public, anon, authenticated;
grant execute on function public.nvx_reconcile_revops_dispatch_attempts() to service_role;

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
  -- Read-only assertion. It deliberately does not call the reconciler: if this
  -- function raises, no persisted reconciliation work can be rolled back.
  select
    count(*) filter (
      where a.outcome in ('failed','timed_out')
         or (
           a.outcome = 'pending'
           and r.id is not null
           and (
             coalesce(r.timed_out, false)
             or r.error_msg is not null
             or r.status_code is null
             or r.status_code < 200
             or r.status_code >= 300
           )
         )
    ),
    count(*) filter (
      where a.outcome = 'missing_response'
         or (a.outcome = 'pending' and r.id is null and a.requested_at < now() - interval '10 minutes')
    )
  into v_failed, v_missing
  from public.revops_dispatch_attempts as a
  left join net._http_response as r on r.id = a.request_id
  where a.requested_at >= now() - interval '15 minutes';

  select coalesce(a.response_status, r.status_code)
  into v_latest_status
  from public.revops_dispatch_attempts as a
  left join net._http_response as r on r.id = a.request_id
  where a.requested_at >= now() - interval '15 minutes'
    and (
      a.outcome in ('failed','timed_out')
      or (
        a.outcome = 'pending'
        and r.id is not null
        and (
          coalesce(r.timed_out, false)
          or r.error_msg is not null
          or r.status_code is null
          or r.status_code < 200
          or r.status_code >= 300
        )
      )
    )
  order by coalesce(a.responded_at, r.created, a.requested_at) desc, a.request_id desc
  limit 1;

  if coalesce(v_failed, 0) > 0 or coalesce(v_missing, 0) > 0 then
    raise exception 'RevOps async dispatch health failed: failed_or_timeout=%, missing_response=%, latest_status=%',
      coalesce(v_failed, 0),
      coalesce(v_missing, 0),
      coalesce(v_latest_status::text, 'none');
  end if;

  return true;
end;
$$;

revoke all on function public.nvx_assert_revops_dispatch_health() from public, anon, authenticated;
grant execute on function public.nvx_assert_revops_dispatch_health() to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in ('nvx-revops-dispatch-reconcile','nvx-revops-dispatch-health')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

-- Reconciliation must commit independently of the fail-closed assertion.
select cron.schedule(
  'nvx-revops-dispatch-reconcile',
  '* * * * *',
  $cron$select * from public.nvx_reconcile_revops_dispatch_attempts();$cron$
);

select cron.schedule(
  'nvx-revops-dispatch-health',
  '* * * * *',
  $cron$select public.nvx_assert_revops_dispatch_health();$cron$
);
