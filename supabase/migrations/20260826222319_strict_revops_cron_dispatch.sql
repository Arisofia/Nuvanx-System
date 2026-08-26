-- Separate business-transaction wakeups from scheduled health semantics.
--
-- Row-level triggers intentionally keep using nvx_try_dispatch_revops_worker()
-- so a transient RevOps routing/transport problem can never roll back a lead,
-- projection, or outbox business transaction.
--
-- pg_cron jobs, however, are operational health checks as well as wakeups.
-- They must use the strict dispatcher so a missing environment-local route or
-- other synchronous dispatch failure is visible in cron.job_run_details rather
-- than being converted into a false successful NULL result.

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
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
