begin;

create or replace function public.nvx_purge_stale_qa_attribution()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox integer := 0;
  v_google integer := 0;
  v_web integer := 0;
begin
  delete from public.google_data_manager_outbox
  where coalesce(is_test_lead, false) = true
    and created_at < now() - interval '30 days';
  get diagnostics v_outbox = row_count;

  delete from public.google_click_attributions
  where coalesce(is_test_lead, false) = true
    and captured_at < now() - interval '30 days';
  get diagnostics v_google = row_count;

  delete from public.web_lead_captures
  where coalesce(is_test_lead, false) = true
    and captured_at < now() - interval '30 days';
  get diagnostics v_web = row_count;

  return jsonb_build_object(
    'google_data_manager_outbox', v_outbox,
    'google_click_attributions', v_google,
    'web_lead_captures', v_web,
    'retention_days', 30
  );
end;
$$;

revoke all on function public.nvx_purge_stale_qa_attribution() from public, anon, authenticated;
grant execute on function public.nvx_purge_stale_qa_attribution() to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'nvx-qa-attribution-retention'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'nvx-qa-attribution-retention',
  '50 3 * * 0',
  $cron$select public.nvx_purge_stale_qa_attribution();$cron$
);

commit;
