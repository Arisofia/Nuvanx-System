-- Database-level purpose limitation: operational lead/Deal creation is independent
-- of marketing consent, but Google attribution application and Data Manager feedback
-- are impossible unless the canonical capture explicitly records consent=true.
create or replace function public.finalize_web_capture_reconciliation(
  p_capture_id uuid,
  p_lead_id uuid,
  p_hubspot_contact_id bigint,
  p_owner_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture public.web_lead_captures%rowtype;
  v_lead public.leads%rowtype;
  v_google_count integer := 0;
begin
  select * into v_capture
  from public.web_lead_captures
  where id = p_capture_id
  for update;
  if not found then raise exception 'Capture not found'; end if;
  if v_capture.is_test_lead then raise exception 'QA capture cannot be reconciled'; end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and deleted_at is null
  for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_lead.source <> 'website_hubspot' then raise exception 'Unexpected lead source'; end if;
  if v_lead.nvx_lead_id is distinct from v_capture.nvx_lead_id then raise exception 'Lead lineage mismatch'; end if;
  if v_lead.hubspot_contact_id is distinct from p_hubspot_contact_id then raise exception 'HubSpot contact mismatch'; end if;
  if v_capture.applied_lead_id is not null and v_capture.applied_lead_id <> p_lead_id then
    raise exception 'Capture already applied to another lead';
  end if;

  if v_capture.marketing_consent and exists (
    select 1
    from public.google_click_attributions g
    where g.nvx_lead_id = v_capture.nvx_lead_id
      and g.applied_lead_id is not null
      and g.applied_lead_id <> p_lead_id
  ) then
    raise exception 'Google attribution lineage conflict';
  end if;

  update public.web_lead_captures
  set applied_lead_id = p_lead_id,
      applied_at = coalesce(applied_at, now()),
      reconciliation_status = 'reconciled',
      reconciliation_error = null,
      reconciled_at = coalesce(reconciled_at, now()),
      last_reconciliation_attempt_at = now(),
      last_seen_at = now()
  where id = p_capture_id;

  if v_capture.marketing_consent then
    update public.google_click_attributions
    set applied_lead_id = p_lead_id,
        applied_at = coalesce(applied_at, now()),
        reconciliation_status = 'reconciled',
        reconciliation_error = null,
        last_reconciliation_attempt_at = now()
    where nvx_lead_id = v_capture.nvx_lead_id
      and coalesce(is_test_lead, false) = false
      and (applied_lead_id is null or applied_lead_id = p_lead_id);
    get diagnostics v_google_count = row_count;
  end if;

  insert into public.hubspot_deal_projections (
    lead_id, hubspot_contact_id, owner_id, projection_status, updated_at
  ) values (
    p_lead_id, p_hubspot_contact_id, nullif(trim(p_owner_id), ''), 'pending', now()
  )
  on conflict (lead_id) do update
  set hubspot_contact_id = excluded.hubspot_contact_id,
      owner_id = coalesce(excluded.owner_id, public.hubspot_deal_projections.owner_id),
      projection_status = case
        when public.hubspot_deal_projections.projection_status = 'suppressed' then 'suppressed'
        else 'pending'
      end,
      last_error = null,
      updated_at = now();

  if v_capture.marketing_consent and v_google_count > 0 then
    perform public.queue_google_data_manager_event(
      p_lead_id,
      'lead',
      coalesce(v_capture.captured_at, now()),
      null,
      'lead:' || p_lead_id::text
    );
  end if;

  return p_lead_id;
end;
$$;

revoke all on function public.finalize_web_capture_reconciliation(uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.finalize_web_capture_reconciliation(uuid,uuid,bigint,text) to service_role;
