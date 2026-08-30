begin;

create or replace function public.nvx_dispatch_meta_hubspot_sync(p_lookback_days integer default 7)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_project_url text;
  v_days integer;
  v_request_id bigint;
begin
  v_days := greatest(1, least(coalesce(p_lookback_days, 7), 90));

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
    raise exception 'Environment-local project URL unavailable';
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/meta-hubspot-sync',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := pg_catalog.jsonb_build_object(
      'mode', 'sync',
      'lookbackDays', v_days
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.nvx_dispatch_meta_hubspot_sync(integer) from public, anon, authenticated;
grant execute on function public.nvx_dispatch_meta_hubspot_sync(integer) to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'nvx-meta-hubspot-sync'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-meta-hubspot-sync',
  '*/15 * * * *',
  $cron$select public.nvx_dispatch_meta_hubspot_sync(7);$cron$
);

commit;
