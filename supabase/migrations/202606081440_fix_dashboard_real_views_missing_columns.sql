-- Align production reporting views with API queries used by the real dashboard.
-- Applied manually to nuvanx-prod on 2026-06-08 before committing this migration.

create or replace view public.vw_campaign_performance_real as
select
  coalesce(u.id, l.user_id) as user_id,
  coalesce(ma.campaign_name, l.campaign_name, 'Organic / Unknown'::character varying) as campaign_name,
  coalesce(ma.campaign_id, l.campaign_id) as campaign_id,
  count(*) as total_leads,
  count(*) filter (where coalesce(ut.lead_stage::text, l.appointment_status::text) = any (array['scheduled'::text,'confirmed'::text,'showed'::text,'completed'::text])) as booked,
  count(*) filter (where coalesce(ut.attended_at, l.attended_at) is not null or coalesce(ut.lead_stage::text, l.appointment_status::text) = any (array['showed'::text,'completed'::text])) as attended,
  count(*) filter (where coalesce(ut.no_show_flag, l.no_show_flag) = true) as no_shows,
  count(*) filter (where coalesce(ut.lead_revenue_verified, l.verified_revenue) > 0::numeric) as closed,
  round(coalesce(sum(coalesce(ut.lead_revenue_estimated, l.revenue)), 0::numeric), 2) as estimated_revenue,
  round(coalesce(sum(coalesce(ut.lead_revenue_verified, l.verified_revenue)), 0::numeric), 2) as verified_revenue_crm,
  round(100.0 * count(*) filter (where coalesce(ut.lead_revenue_verified, l.verified_revenue) > 0::numeric)::numeric / nullif(count(*), 0)::numeric, 1) as lead_to_close_rate_pct,
  round(100.0 * count(*) filter (where coalesce(ut.no_show_flag, l.no_show_flag) = true)::numeric / nullif(count(*) filter (where coalesce(ut.lead_stage::text, l.appointment_status::text) is not null), 0)::numeric, 1) as no_show_rate_pct,
  min(coalesce(ut.lead_created_at, l.created_at)) as first_lead_at,
  max(coalesce(ut.lead_created_at, l.created_at)) as last_lead_at,
  coalesce(nullif(l.utm_source, ''), nullif(l.source::text, ''), case when ma.lead_id is not null then 'meta' else 'unknown' end)::text as source
from public.leads l
left join public.vw_doctoralia_lead_traceability_unified ut on ut.lead_id = l.id
left join public.meta_attribution ma on ma.lead_id = l.id
left join public.users u on u.id = l.user_id
where l.deleted_at is null
group by coalesce(u.id, l.user_id), coalesce(ma.campaign_name, l.campaign_name, 'Organic / Unknown'::character varying), coalesce(ma.campaign_id, l.campaign_id), coalesce(nullif(l.utm_source, ''), nullif(l.source::text, ''), case when ma.lead_id is not null then 'meta' else 'unknown' end)::text;

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
