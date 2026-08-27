-- Reduce scheduled RevOps fallback wakeups while preserving immediate business-event wakeups.
-- web-lead-reconcile is triggered immediately by the lead-captured Edge Function.
-- deal-factory is triggered immediately by hubspot_deal_projection_wake_worker.
-- Scheduled jobs are fallback/health wakeups only and must skip idle cycles.

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
      'nvx-cron-history-retention'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-web-lead-reconcile',
  '0 4,12,20 * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('web-lead-reconcile', 50, null)
    where exists (
      select 1
      from public.web_lead_captures
      where applied_lead_id is null
        and reconciliation_status in ('pending', 'failed')
      limit 1
    );
  $cron$
);

select cron.schedule(
  'nvx-deal-factory',
  '0 4,12,20 * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('deal-factory', 50, null)
    where exists (
      select 1
      from public.hubspot_deal_projections
      where projection_status = 'pending'
      limit 1
    );
  $cron$
);

-- pg_cron does not prune its run history automatically. Keep only completed
-- run records from the last 30 days. Weekly execution is sufficient at this scale.
select cron.schedule(
  'nvx-cron-history-retention',
  '40 3 * * 0',
  $cron$
    delete from cron.job_run_details
    where end_time < now() - interval '30 days';
  $cron$
);
