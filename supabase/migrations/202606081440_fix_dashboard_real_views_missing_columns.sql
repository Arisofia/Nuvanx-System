-- Align production reporting views with API queries used by the real dashboard.
-- Fix dashboard/report API contract for real dashboard views.
-- These views are consumed by Supabase Edge Function routes that expect:
-- - vw_campaign_performance_real.source
-- - vw_doctor_performance_real.clinic_id
--
-- This migration drops and recreates the views because PostgreSQL cannot change
-- existing view column types/order using CREATE OR REPLACE VIEW.
-- It also avoids referencing non-existent columns such as
-- vw_doctoralia_lead_traceability_unified.status in production.

drop view if exists public.vw_campaign_performance_real;
drop view if exists public.vw_doctor_performance_real;

create view public.vw_campaign_performance_real as
select
  l.user_id,
  coalesce(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text as campaign_name,
  coalesce(ma.campaign_id, l.campaign_id)::text as campaign_id,
  coalesce(
    nullif(l.utm_source, ''),
    nullif(l.source::text, ''),
    case when ma.lead_id is not null then 'meta' else 'unknown' end
  )::text as source,
  count(*)::bigint as total_leads,
  0::bigint as contacted,
  0::bigint as replied,
  count(*) filter (
    where coalesce(ut.lead_stage::text, l.appointment_status::text, l.stage::text) in ('scheduled', 'confirmed', 'showed', 'completed')
  )::bigint as booked,
  count(*) filter (
    where coalesce(ut.attended_at, l.attended_at) is not null
       or coalesce(ut.lead_stage::text, l.appointment_status::text, l.stage::text) in ('showed', 'completed')
  )::bigint as attended,
  count(*) filter (
    where coalesce(ut.no_show_flag, l.no_show_flag, false) = true
       or coalesce(ut.lead_stage::text, l.appointment_status::text, l.stage::text) in ('no_show', 'no-show', 'noshow')
  )::bigint as no_shows,
  count(*) filter (
    where coalesce(ut.lead_stage::text, l.stage::text) in ('closed', 'won', 'paid')
       or coalesce(ut.lead_revenue_verified, l.verified_revenue, l.revenue, 0) > 0
  )::bigint as closed,
  count(*) filter (
    where coalesce(ut.lead_revenue_verified, l.verified_revenue, 0) > 0
  )::bigint as closed_won,
  round(coalesce(sum(coalesce(ut.lead_revenue_estimated, l.revenue, 0)), 0), 2)::numeric as estimated_revenue,
  round(coalesce(sum(coalesce(ut.lead_revenue_verified, l.verified_revenue, 0)), 0), 2)::numeric as verified_revenue_crm,
  null::numeric as reply_rate_pct,
  null::numeric as replied_to_booked_pct,
  round(
    100.0 * count(*) filter (
      where coalesce(ut.lead_stage::text, l.stage::text) in ('closed', 'won', 'paid')
         or coalesce(ut.lead_revenue_verified, l.verified_revenue, l.revenue, 0) > 0
    ) / nullif(count(*), 0),
    2
  ) as lead_to_close_rate_pct,
  round(
    100.0 * count(*) filter (
      where coalesce(ut.no_show_flag, l.no_show_flag, false) = true
         or coalesce(ut.lead_stage::text, l.appointment_status::text, l.stage::text) in ('no_show', 'no-show', 'noshow')
    ) / nullif(count(*), 0),
    2
  ) as no_show_rate_pct,
  null::numeric as avg_reply_delay_min,
  min(coalesce(ut.lead_created_at, l.created_at)) as first_lead_at,
  max(coalesce(ut.lead_created_at, l.created_at)) as last_lead_at
from public.leads l
left join public.vw_doctoralia_lead_traceability_unified ut
  on ut.lead_id = l.id
left join public.meta_attribution ma
  on ma.lead_id = l.id
where l.deleted_at is null
group by
  l.user_id,
  coalesce(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text,
  coalesce(ma.campaign_id, l.campaign_id)::text,
  coalesce(
    nullif(l.utm_source, ''),
    nullif(l.source::text, ''),
    case when ma.lead_id is not null then 'meta' else 'unknown' end
  )::text;

alter view public.vw_campaign_performance_real
set (security_invoker = true);

grant select on public.vw_campaign_performance_real to service_role;
grant select on public.vw_campaign_performance_real to authenticated;

create view public.vw_doctor_performance_real as
select
  d.id as doctor_id,
  d.name as doctor_name,
  d.specialty,
  d.is_active,
  0::bigint as total_appointments,
  0::bigint as attended_count,
  0::bigint as no_show_count,
  0::bigint as cancelled_count,
  0::bigint as confirmed_count,
  null::numeric as attended_rate_pct,
  null::numeric as no_show_rate_pct,
  0::numeric as estimated_revenue,
  0::numeric as verified_revenue_crm,
  d.clinic_id as clinic_id
from public.doctors d;

alter view public.vw_doctor_performance_real
set (security_invoker = true);

grant select on public.vw_doctor_performance_real to service_role;
grant select on public.vw_doctor_performance_real to authenticated;
