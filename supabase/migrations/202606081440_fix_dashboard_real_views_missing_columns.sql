-- Align production reporting views with API queries used by the real dashboard.
-- Fix dashboard/report API contract for real dashboard views.
-- These views are consumed by Supabase Edge Function routes that expect:
-- - vw_campaign_performance_real.source
-- - vw_doctor_performance_real.clinic_id
--
-- The production API was returning 502 because those columns did not exist.

create or replace view public.vw_campaign_performance_real as
select
  l.user_id,
  coalesce(l.campaign_name, ma.campaign_name, 'Sin campaña')::text as campaign_name,
  coalesce(l.campaign_id, ma.campaign_id)::text as campaign_id,
  coalesce(
    nullif(l.utm_source, ''),
    nullif(l.source::text, ''),
    case when ma.lead_id is not null then 'meta' else 'unknown' end
  )::text as source,
  count(*)::bigint as total_leads,
  count(*) filter (where lower(coalesce(t.status, '')) in ('booked', 'confirmed', 'scheduled'))::bigint as booked,
  count(*) filter (where lower(coalesce(t.status, '')) in ('attended', 'completed'))::bigint as attended,
  count(*) filter (where lower(coalesce(t.status, '')) in ('no_show', 'no-show', 'noshow'))::bigint as no_shows,
  count(*) filter (where lower(coalesce(t.status, '')) in ('closed', 'won', 'paid'))::bigint as closed,
  coalesce(sum(t.estimated_revenue), 0)::numeric as estimated_revenue,
  coalesce(sum(t.verified_revenue_crm), 0)::numeric as verified_revenue_crm,
  round(
    100.0 * count(*) filter (where lower(coalesce(t.status, '')) in ('closed', 'won', 'paid')) /
    nullif(count(*), 0),
    2
  ) as lead_to_close_rate_pct,
  round(
    100.0 * count(*) filter (where lower(coalesce(t.status, '')) in ('no_show', 'no-show', 'noshow')) /
    nullif(count(*), 0),
    2
  ) as no_show_rate_pct,
  min(l.created_at) as first_lead_at,
  max(l.created_at) as last_lead_at
from public.leads l
left join public.vw_doctoralia_lead_traceability_unified t
  on t.lead_id = l.id
left join public.meta_attribution ma
  on ma.lead_id = l.id
where l.deleted_at is null
group by
  l.user_id,
  coalesce(l.campaign_name, ma.campaign_name, 'Sin campaña')::text,
  coalesce(l.campaign_id, ma.campaign_id)::text,
  coalesce(
    nullif(l.utm_source, ''),
    nullif(l.source::text, ''),
    case when ma.lead_id is not null then 'meta' else 'unknown' end
  )::text;

create or replace view public.vw_doctor_performance_real as
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
