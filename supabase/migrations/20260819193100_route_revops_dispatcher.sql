-- Environment-safe RevOps worker routing.
--
-- Postgres never stores the Supabase service-role credential. It calls one narrow
-- dispatcher with a Vault-generated internal secret. The project URL is provisioned
-- at runtime by the environment's runtime-bootstrap function; it is deliberately not
-- hardcoded so preview branches can never call production by migration side effect.

create or replace function public.nvx_set_revops_project_url(p_value text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_value text;
begin
  v_value := trim(coalesce(p_value, ''));
  if v_value !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Invalid Supabase project URL';
  end if;

  select id into v_id from vault.secrets where name = 'REVOPS_PROJECT_URL' limit 1;
  if v_id is null then
    perform vault.create_secret(v_value, 'REVOPS_PROJECT_URL', 'NUVANX environment-local Supabase project URL', null);
  else
    perform vault.update_secret(v_id, v_value, 'REVOPS_PROJECT_URL', 'NUVANX environment-local Supabase project URL', null);
  end if;
  return true;
end;
$$;

revoke all on function public.nvx_set_revops_project_url(text) from public, anon, authenticated;
grant execute on function public.nvx_set_revops_project_url(text) to service_role;

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
  return v_request_id;
end;
$$;

revoke all on function public.nvx_dispatch_revops_worker(text,integer,text) from public, anon, authenticated;
grant execute on function public.nvx_dispatch_revops_worker(text,integer,text) to service_role;

-- Immediate Deal Factory wake-up when a real reconciliation queues a projection.
create or replace function public.nvx_wake_deal_factory_on_pending_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.projection_status = 'pending'
     and (tg_op = 'INSERT' or old.projection_status is distinct from 'pending') then
    perform public.nvx_dispatch_revops_worker('deal-factory', 20, null);
  end if;
  return new;
end;
$$;

revoke all on function public.nvx_wake_deal_factory_on_pending_projection() from public, anon, authenticated;

drop trigger if exists hubspot_deal_projection_wake_worker on public.hubspot_deal_projections;
create trigger hubspot_deal_projection_wake_worker
after insert or update of projection_status on public.hubspot_deal_projections
for each row execute function public.nvx_wake_deal_factory_on_pending_projection();

-- Wake Google delivery only for real pending outbox rows. QA rows are never sent.
create or replace function public.nvx_wake_google_data_manager_on_pending_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_test_lead, false) = false
     and new.delivery_status = 'pending'
     and (tg_op = 'INSERT' or old.delivery_status is distinct from 'pending') then
    perform public.nvx_dispatch_revops_worker('google-data-manager-export', 20, 'deliver');
  end if;
  return new;
end;
$$;

revoke all on function public.nvx_wake_google_data_manager_on_pending_outbox() from public, anon, authenticated;

drop trigger if exists google_data_manager_outbox_wake_worker on public.google_data_manager_outbox;
create trigger google_data_manager_outbox_wake_worker
after insert or update of delivery_status on public.google_data_manager_outbox
for each row execute function public.nvx_wake_google_data_manager_on_pending_outbox();

-- Recovery schedules. Before runtime bootstrap seeds REVOPS_PROJECT_URL they fail
-- closed without an outbound request. Once bootstrapped they recover transient worker
-- failures without human intervention.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in (
      'nvx-web-lead-reconcile',
      'nvx-deal-factory',
      'nvx-google-data-manager-deliver',
      'nvx-google-data-manager-poll'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-web-lead-reconcile',
  '*/5 * * * *',
  $cron$select public.nvx_dispatch_revops_worker('web-lead-reconcile', 50, null);$cron$
);

select cron.schedule(
  'nvx-deal-factory',
  '*/5 * * * *',
  $cron$select public.nvx_dispatch_revops_worker('deal-factory', 50, null);$cron$
);

select cron.schedule(
  'nvx-google-data-manager-deliver',
  '*/5 * * * *',
  $cron$select public.nvx_dispatch_revops_worker('google-data-manager-export', 50, 'deliver');$cron$
);

select cron.schedule(
  'nvx-google-data-manager-poll',
  '2-59/5 * * * *',
  $cron$select public.nvx_dispatch_revops_worker('google-data-manager-export', 50, 'poll');$cron$
);
