-- Harden the existing daily Meta scheduler without creating a second owner.
-- The 05:00 pg_cron job authenticates with the environment-local Vault secret;
-- GitHub reconciliation continues to use the service-role Bearer path.

do $$
declare
  v_job record;
  v_command text;
  v_old text := $old$'Authorization', 'Bearer ' || current_setting('SUPABASE_SERVICE_ROLE_KEY', true),$old$;
  v_new text := $new$'x-nvx-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'REVOPS_INTERNAL_SECRET' limit 1),$new$;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'Skipping daily-aggregates auth hardening: pg_cron is unavailable';
    return;
  end if;

  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'REVOPS_INTERNAL_SECRET'
      and length(trim(decrypted_secret)) >= 32
  ) then
    raise exception 'REVOPS_INTERNAL_SECRET is unavailable; refusing to leave daily-aggregates scheduler unauthenticated';
  end if;

  for v_job in
    select jobid, command
    from cron.job
    where jobname = 'fetch-meta-daily-insights'
  loop
    v_command := v_job.command;

    if position('x-nvx-internal-secret' in v_command) > 0 then
      continue;
    end if;

    if position(v_old in v_command) = 0 then
      raise exception 'Unexpected fetch-meta-daily-insights auth contract; refusing unsafe rewrite';
    end if;

    v_command := replace(v_command, v_old, v_new);
    perform cron.alter_job(v_job.jobid, command := v_command);
  end loop;
end;
$$;
