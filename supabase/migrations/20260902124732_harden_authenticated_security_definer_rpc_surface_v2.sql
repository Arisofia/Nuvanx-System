begin;

create schema if not exists private authorization postgres;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE proname = 'nvx_get_attribution_health' AND n.nspname = 'public') THEN
    alter function public.nvx_get_attribution_health() set schema private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE proname = 'nvx_get_control_centre_lead_timeline' AND n.nspname = 'public') THEN
    alter function public.nvx_get_control_centre_lead_timeline(uuid, integer) set schema private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE proname = 'nvx_get_control_centre_pipeline' AND n.nspname = 'public') THEN
    alter function public.nvx_get_control_centre_pipeline(integer, integer) set schema private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE proname = 'nvx_get_dashboard_metrics_v2' AND n.nspname = 'public') THEN
    alter function public.nvx_get_dashboard_metrics_v2(date, date, text, text) set schema private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE proname = 'nvx_get_hubspot_marketing_contact_monitor' AND n.nspname = 'public') THEN
    alter function public.nvx_get_hubspot_marketing_contact_monitor() set schema private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE proname = 'nvx_set_lead_pipeline_state' AND n.nspname = 'public') THEN
    alter function public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) set schema private;
  END IF;
END $$;

revoke all on function private.nvx_get_attribution_health() from public, anon;
revoke all on function private.nvx_get_control_centre_lead_timeline(uuid, integer) from public, anon;
revoke all on function private.nvx_get_control_centre_pipeline(integer, integer) from public, anon;
revoke all on function private.nvx_get_dashboard_metrics_v2(date, date, text, text) from public, anon;
revoke all on function private.nvx_get_hubspot_marketing_contact_monitor() from public, anon;
revoke all on function private.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) from public, anon;

grant execute on function private.nvx_get_attribution_health() to authenticated, service_role;
grant execute on function private.nvx_get_control_centre_lead_timeline(uuid, integer) to authenticated, service_role;
grant execute on function private.nvx_get_control_centre_pipeline(integer, integer) to authenticated, service_role;
grant execute on function private.nvx_get_dashboard_metrics_v2(date, date, text, text) to authenticated, service_role;
grant execute on function private.nvx_get_hubspot_marketing_contact_monitor() to authenticated, service_role;
grant execute on function private.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) to authenticated, service_role;

create or replace function public.nvx_get_attribution_health()
returns jsonb
language sql
security invoker
set search_path = ''
as $func$ select private.nvx_get_attribution_health() $func$;

create or replace function public.nvx_get_control_centre_lead_timeline(p_lead_id uuid, p_limit integer default 200)
returns setof public.vw_control_centre_lead_timeline
language sql
security invoker
set search_path = ''
as $func$ select * from private.nvx_get_control_centre_lead_timeline(p_lead_id, p_limit) $func$;

create or replace function public.nvx_get_control_centre_pipeline(p_limit integer default 200, p_offset integer default 0)
returns setof public.vw_control_centre_pipeline
language sql
security invoker
set search_path = ''
as $func$ select * from private.nvx_get_control_centre_pipeline(p_limit, p_offset) $func$;

create or replace function public.nvx_get_dashboard_metrics_v2(
  p_from date default (current_date - 30),
  p_to date default current_date,
  p_campaign_id text default null,
  p_source text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $func$ select private.nvx_get_dashboard_metrics_v2(p_from, p_to, p_campaign_id, p_source) $func$;

create or replace function public.nvx_get_hubspot_marketing_contact_monitor()
returns table (
  threshold integer,
  last_count integer,
  above_threshold boolean,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
set search_path = ''
as $func$ select * from private.nvx_get_hubspot_marketing_contact_monitor() $func$;

create or replace function public.nvx_set_lead_pipeline_state(
  p_lead_id uuid,
  p_stage text default null,
  p_next_action text default null,
  p_due_at timestamptz default null,
  p_lost_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $func$ select private.nvx_set_lead_pipeline_state(p_lead_id, p_stage, p_next_action, p_due_at, p_lost_reason) $func$;

revoke all on function public.nvx_get_attribution_health() from public, anon;
revoke all on function public.nvx_get_control_centre_lead_timeline(uuid, integer) from public, anon;
revoke all on function public.nvx_get_control_centre_pipeline(integer, integer) from public, anon;
revoke all on function public.nvx_get_dashboard_metrics_v2(date, date, text, text) from public, anon;
revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from public, anon;
revoke all on function public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) from public, anon;

grant execute on function public.nvx_get_attribution_health() to authenticated, service_role;
grant execute on function public.nvx_get_control_centre_lead_timeline(uuid, integer) to authenticated, service_role;
grant execute on function public.nvx_get_control_centre_pipeline(integer, integer) to authenticated, service_role;
grant execute on function public.nvx_get_dashboard_metrics_v2(date, date, text, text) to authenticated, service_role;
grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to authenticated, service_role;
grant execute on function public.nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text) to authenticated, service_role;

commit;
