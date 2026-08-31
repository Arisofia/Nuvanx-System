create or replace function public.nvx_dispatch_maintenance_worker(
  p_worker text,
  p_from date,
  p_to date
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_project_url text;
  v_url text;
  v_body jsonb;
  v_request_id bigint;
begin
  if p_worker not in ('meta-lead-backfill','meta-daily-insights') then
    raise exception 'Unsupported maintenance worker';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid maintenance date range';
  end if;
  if (p_to - p_from) > 93 then
    raise exception 'Maintenance date range exceeds 93 days';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'REVOPS_INTERNAL_SECRET'
  limit 1;
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'Internal maintenance credential unavailable';
  end if;

  select trim(decrypted_secret) into v_project_url
  from vault.decrypted_secrets
  where name = 'REVOPS_PROJECT_URL'
  limit 1;
  if v_project_url is null or v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Environment-local project URL unavailable';
  end if;

  if p_worker = 'meta-lead-backfill' then
    v_url := v_project_url || '/functions/v1/meta-lead-backfill';
    v_body := pg_catalog.jsonb_build_object('since', p_from::text, 'until', p_to::text);
  else
    v_url := v_project_url || '/functions/v1/meta-daily-insights';
    v_body := pg_catalog.jsonb_build_object('from', p_from::text, 'to', p_to::text);
  end if;

  select net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := v_body,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.nvx_dispatch_maintenance_worker(text,date,date) from public;
grant execute on function public.nvx_dispatch_maintenance_worker(text,date,date) to service_role;

select cron.alter_job(
  26,
  command := $$select public.nvx_dispatch_maintenance_worker('meta-daily-insights', current_date - 2, current_date);$$,
  active := true
);
