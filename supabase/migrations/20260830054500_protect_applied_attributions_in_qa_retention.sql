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

  delete from public.google_click_attributions g
  where coalesce(g.is_test_lead, false) = true
    and g.applied_lead_id is null
    and g.captured_at < now() - interval '30 days'
    and not exists (
      select 1
      from public.google_data_manager_outbox o
      where o.attribution_id = g.id
        and coalesce(o.is_test_lead, false) = false
    );
  get diagnostics v_google = row_count;

  delete from public.web_lead_captures w
  where coalesce(w.is_test_lead, false) = true
    and w.applied_lead_id is null
    and w.captured_at < now() - interval '30 days';
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

commit;
