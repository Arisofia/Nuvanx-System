-- Avoid invoking Google Data Manager OAuth on scheduled cycles when there is
-- no durable outbox work to deliver or poll. Row-level pending-outbox triggers
-- remain unchanged and continue to wake the worker immediately.
--
-- If real work exists, the strict dispatcher is still used so routing failures
-- remain visible and provider/OAuth failures remain observable in worker
-- responses. This only removes idle 503 noise from an empty outbox.

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'nvx-google-data-manager-deliver',
      'nvx-google-data-manager-poll'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-google-data-manager-deliver',
  '*/5 * * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('google-data-manager-export', 50, 'deliver')
    where exists (
      select 1
      from public.google_data_manager_outbox
      where delivery_status in ('pending', 'failed', 'configuration_required')
      limit 1
    );
  $cron$
);

select cron.schedule(
  'nvx-google-data-manager-poll',
  '2-59/5 * * * *',
  $cron$
    select public.nvx_dispatch_revops_worker('google-data-manager-export', 50, 'poll')
    where exists (
      select 1
      from public.google_data_manager_outbox
      where delivery_status = 'sent'
        and provider_request_id is not null
        and delivered_at is null
      limit 1
    );
  $cron$
);
