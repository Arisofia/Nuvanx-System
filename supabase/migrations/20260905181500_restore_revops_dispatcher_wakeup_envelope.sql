-- Restore the RevOps dispatcher pg_net call to a short wakeup envelope.
--
-- 20260905180500 widened this to 30s because revops-dispatcher synchronously
-- awaited downstream workers. revops-dispatcher now accepts the wakeup and
-- runs the selected worker with EdgeRuntime.waitUntil(), so the outer pg_net
-- request must again measure only dispatcher reachability/acceptance. Keeping
-- this at 5s preserves detection of real routing/DNS failures instead of
-- masking them behind downstream CRM/provider execution time.

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
  v_allows_mode boolean;
  v_body jsonb;
  v_request_id bigint;
begin
  select r.allows_mode
    into v_allows_mode
  from public.revops_worker_registry r
  where r.worker = p_worker
    and r.enabled = true;

  if not found then
    raise exception 'Unsupported RevOps worker';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));
  v_mode := nullif(pg_catalog.btrim(coalesce(p_mode, '')), '');

  if p_worker = 'google-data-manager-export' then
    if v_mode is not null and v_mode not in ('deliver', 'poll') then
      raise exception 'Unsupported Google Data Manager mode';
    end if;
  elsif not v_allows_mode and v_mode is not null then
    raise exception 'Worker mode is not supported for this worker';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'REVOPS_INTERNAL_SECRET'
  limit 1;
  if v_secret is null or pg_catalog.length(v_secret) < 32 then
    raise exception 'Internal worker credential unavailable';
  end if;

  select pg_catalog.btrim(decrypted_secret) into v_project_url
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
