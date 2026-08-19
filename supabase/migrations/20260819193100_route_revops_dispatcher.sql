-- Keep Postgres unaware of the Supabase service-role credential. It calls one
-- narrow dispatcher authenticated by a Vault-generated least-privilege secret;
-- the dispatcher then invokes the allowlisted worker with its runtime service role.
create or replace function public.nvx_dispatch_revops_worker(p_worker text, p_limit integer default 25)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_limit integer;
  v_request_id bigint;
begin
  if p_worker not in ('web-lead-reconcile','deal-factory') then
    raise exception 'Unsupported RevOps worker';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'REVOPS_INTERNAL_SECRET'
  limit 1;
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'Internal worker credential unavailable';
  end if;

  select net.http_post(
    url := 'https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/revops-dispatcher',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := pg_catalog.jsonb_build_object('worker', p_worker, 'limit', v_limit),
    timeout_milliseconds := 5000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.nvx_dispatch_revops_worker(text,integer) from public, anon, authenticated;
grant execute on function public.nvx_dispatch_revops_worker(text,integer) to service_role;
