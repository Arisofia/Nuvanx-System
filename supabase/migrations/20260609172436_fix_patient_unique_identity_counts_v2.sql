drop view if exists public.v_new_clients_by_channel_monthly;

create or replace view public.v_new_clients_by_channel_detail as
with social_leads as (
  select
    l.id::text as record_id,
    l.appointment_date as event_at,
    date_trunc('month', l.appointment_date)::date as month,
    to_char(date_trunc('month', l.appointment_date), 'YYYY-MM') as month_key,
    l.user_id,
    l.clinic_id,
    'social'::text as channel_group,
    coalesce(l.source, 'meta_leadgen'::varchar)::text as channel_source,
    coalesce(l.campaign_name, 'Sin campaña'::varchar)::text as campaign_name,
    nullif(trim(l.name), '') as client_name,
    l.phone_normalized::text as phone_normalized,
    COALESCE(l.normalized_email, l.email)::text as email_normalized,
    l.treatment_name::text as treatment_name,
    coalesce(l.verified_revenue, 0::numeric) as revenue,
    (coalesce(l.verified_revenue, 0::numeric) > 0::numeric) as is_attributable_patient,
    'lead_valuation'::text as source_record_type,
    lower(coalesce(nullif(l.phone_normalized::text, ''), nullif(COALESCE(l.normalized_email, l.email)::text, ''), nullif(public.normalize_name(l.name), ''), nullif(l.name::text, ''), l.id::text)) as identity_key
  from public.leads l
  where l.deleted_at is null
    and l.appointment_date is not null
    and l.appointment_date >= '2024-01-01'::date
),
other_financial as (
  select
    fs.id::text as record_id,
    fs.settled_at as event_at,
    date_trunc('month', fs.settled_at)::date as month,
    to_char(date_trunc('month', fs.settled_at), 'YYYY-MM') as month_key,
    null::uuid as user_id,
    fs.clinic_id,
    'other'::text as channel_group,
    coalesce(fs.source_system, 'doctoralia'::varchar)::text as channel_source,
    coalesce(fs.agenda_name, fs.intermediary_name, fs.template_name, 'Doctoralia / otros'::varchar)::text as campaign_name,
    coalesce(nullif(trim(fs.patient_name), ''), nullif(trim(fs.template_patient_name), ''), nullif(trim(fs.patient_phone), ''), 'Paciente sin nombre') as client_name,
    fs.phone_normalized,
    null::text as email_normalized,
    fs.template_name::text as treatment_name,
    coalesce(fs.amount_net, 0::numeric) as revenue,
    true as is_attributable_patient,
    'financial_settlement'::text as source_record_type,
    lower(coalesce(nullif(fs.phone_normalized, ''), nullif(regexp_replace(coalesce(fs.patient_phone, ''), '\D', '', 'g'), ''), nullif(fs.patient_dni::text, ''), nullif(fs.patient_name::text, ''), nullif(fs.template_patient_name, ''), fs.id::text)) as identity_key
  from public.financial_settlements fs
  where extract(year from fs.settled_at) >= 2024
    and fs.source_system::text = 'doctoralia'
),
unioned as (
  select * from social_leads
  union all
  select * from other_financial
),
classified as (
  select
    u.*,
    row_number() over (
      partition by u.channel_group, u.identity_key, u.is_attributable_patient
      order by u.event_at, u.record_id
    ) as patient_rn_by_channel,
    row_number() over (
      partition by u.identity_key, u.is_attributable_patient
      order by u.event_at, u.record_id
    ) as patient_rn_global
  from unioned u
  where u.identity_key is not null
)
select
  record_id,
  event_at,
  month,
  month_key,
  user_id,
  clinic_id,
  channel_group,
  channel_source,
  campaign_name,
  client_name,
  phone_normalized,
  email_normalized,
  treatment_name,
  revenue,
  is_attributable_patient as is_real_client,
  (is_attributable_patient and patient_rn_by_channel = 1) as is_new_client_by_channel,
  (is_attributable_patient and patient_rn_global = 1) as is_new_client_global,
  source_record_type,
  identity_key
from classified;

create view public.v_new_clients_by_channel_monthly as
select
  month_key,
  user_id,
  clinic_id,
  channel_group,
  channel_source,
  campaign_name,
  count(distinct identity_key) as client_touchpoints_unique,
  count(distinct identity_key) filter (where is_real_client) as real_clients_unique,
  count(distinct identity_key) filter (where is_new_client_by_channel) as new_clients_unique_by_channel,
  count(distinct identity_key) filter (where is_new_client_global) as new_clients_unique_global,
  sum(revenue) as revenue,
  round(
    (100.0 * count(distinct identity_key) filter (where is_real_client)::numeric)
    / nullif(count(distinct identity_key), 0)::numeric,
    2
  ) as client_conversion_rate_pct
from public.v_new_clients_by_channel_detail
group by month_key, user_id, clinic_id, channel_group, channel_source, campaign_name;
