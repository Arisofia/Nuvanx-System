-- Read-only reconciliation layer for canonical web captures, Google click
-- collector rows, and the later operational public.leads linkage.
--
-- This migration does not mutate lead attribution, create Deals, or send
-- advertising feedback. It exposes deterministic reconciliation state only.

create or replace view public.web_attribution_reconciliation_v1
with (security_invoker = true)
as
select
  c.id as capture_id,
  c.nvx_lead_id,
  c.form_id,
  c.hubspot_contact_id,
  c.hubspot_submission_id,
  c.is_test_lead,
  c.test_run_id,
  c.captured_at,
  c.last_seen_at,
  c.applied_lead_id as capture_applied_lead_id,
  c.applied_at as capture_applied_at,
  g.id as google_attribution_id,
  g.submission_id as google_submission_id,
  g.gclid,
  g.gbraid,
  g.wbraid,
  g.gclsrc,
  g.captured_at as google_captured_at,
  g.applied_lead_id as google_applied_lead_id,
  g.applied_at as google_applied_at,
  case
    when c.is_test_lead then 'qa_suppressed'
    when c.applied_lead_id is null and g.id is null then 'capture_only'
    when c.applied_lead_id is null and g.id is not null then 'collector_linked'
    when c.applied_lead_id is not null and g.id is null then 'operational_lead_no_google_click'
    when c.applied_lead_id is not null and g.applied_lead_id is null then 'operational_lead_pending_google_apply'
    when c.applied_lead_id = g.applied_lead_id then 'reconciled'
    else 'conflict'
  end as reconciliation_state
from public.web_lead_captures c
left join public.google_click_attributions g
  on g.nvx_lead_id = c.nvx_lead_id;

comment on view public.web_attribution_reconciliation_v1 is
  'Read-only lineage audit joining canonical web captures to Google click collector rows by nvx_lead_id. QA rows are explicitly marked and no side effects occur.';

revoke all on public.web_attribution_reconciliation_v1 from anon, authenticated;
grant select on public.web_attribution_reconciliation_v1 to service_role;

create or replace view public.web_attribution_reconciliation_summary_v1
with (security_invoker = true)
as
select
  c.id as capture_id,
  c.nvx_lead_id,
  c.hubspot_contact_id,
  c.is_test_lead,
  c.captured_at,
  c.applied_lead_id,
  count(g.id)::integer as google_collector_rows,
  count(g.id) filter (where g.applied_lead_id is not null)::integer as google_applied_rows,
  count(g.id) filter (
    where c.applied_lead_id is not null
      and g.applied_lead_id is not null
      and g.applied_lead_id <> c.applied_lead_id
  )::integer as google_conflict_rows,
  case
    when c.is_test_lead then 'qa_suppressed'
    when c.applied_lead_id is null and count(g.id) = 0 then 'capture_only'
    when c.applied_lead_id is null then 'collector_linked'
    when count(g.id) = 0 then 'operational_lead_no_google_click'
    when count(g.id) filter (
      where g.applied_lead_id is not null
        and g.applied_lead_id <> c.applied_lead_id
    ) > 0 then 'conflict'
    when count(g.id) filter (where g.applied_lead_id is null) > 0 then 'operational_lead_pending_google_apply'
    else 'reconciled'
  end as reconciliation_state
from public.web_lead_captures c
left join public.google_click_attributions g
  on g.nvx_lead_id = c.nvx_lead_id
group by
  c.id,
  c.nvx_lead_id,
  c.hubspot_contact_id,
  c.is_test_lead,
  c.captured_at,
  c.applied_lead_id;

comment on view public.web_attribution_reconciliation_summary_v1 is
  'One row per canonical web capture with collector counts and deterministic reconciliation state. No raw email, phone, name, or clinical semantics are exposed.';

revoke all on public.web_attribution_reconciliation_summary_v1 from anon, authenticated;
grant select on public.web_attribution_reconciliation_summary_v1 to service_role;
