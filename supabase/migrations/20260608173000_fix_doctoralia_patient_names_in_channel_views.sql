-- Fix Doctoralia patient names in channel conversion reporting.
-- financial_settlements.patient_name is empty in current Doctoralia data,
-- while template_patient_name and patient_phone contain usable identity fields.

CREATE OR REPLACE VIEW public.v_new_clients_by_channel_detail
WITH (security_invoker = true) AS
WITH social_leads AS (
  SELECT
    l.id::text AS record_id,
    l.appointment_date AS event_at,
    date_trunc('month', l.appointment_date)::date AS month,
    to_char(date_trunc('month', l.appointment_date), 'YYYY-MM') AS month_key,
    'social'::text AS channel_group,
    COALESCE(l.source, 'meta_leadgen')::text AS channel_source,
    COALESCE(l.campaign_name, 'Sin campaña')::text AS campaign_name,
    NULLIF(TRIM(l.name), '')::text AS client_name,
    l.phone_normalized::text AS phone_normalized,
                             AS email_normalized,
    lower(COALESCE(
      NULLIF(l.phone_normalized, ''),
      NULLIF(l.email_normalized, ''),
      NULLIF(l.name_normalized::text, ''),
      NULLIF(l.name::text, ''),
      l.id::text
    )) AS identity_key,
                                                           l.verified_revenue, 0::numeric) AS revenue,
    COALESCE(l.verified_revenue, 0::numeric) > 0::numeric AS is_real_client,
    'lead_valuation'::text AS source_record_type
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND l.appointment_date IS NOT NULL
    AND l.appointment_date >= date '2024-01-01'
),
other_financial AS (
  SELECT
    fs.id::text AS record_id,
    fs.settled_at AS event_at,
    date_trunc('month', fs.settled_at)::date AS month,
    to_char(date_trunc('month', fs.settled_at), 'YYYY-MM') AS month_key,
    'other'::text AS channel_group,
    COALESCE(fs.source_system, 'doctoralia')::text AS channel_source,
    COALESCE(fs.agenda_name, fs.intermediary_name, fs.template_name    COALESCE(fs.agenda_name, fs.intermediary_na
    COALESCE(
      NU LIF(TRIM(fs.patient_name), ''),
      NULLIF(TRIM(fs.template_patient_name), ''),
      NULLIF(TRIM(fs.patient_phone), ''),
      'Paciente sin nombre'
    )::text AS client_name,
    fs.phone_normalized::text AS phone_normalized,
    NULL::text AS email_normalized,
    lower(COALESCE(
      NULLIF(fs.phone_normalized, ''),
      NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\D', '', 'g'), ''),
      NULLIF(fs.patient_dni::text, ''),
      NULLIF(fs.patient_name::text, ''),
      NULLIF(fs.templa      NULLIF(fs.templa      NULLIF(fs.templa      )      NULLity_key,
    fs.temp    fs.temp    fs.temp    fs_n    fs.temp    fs.temp    fsnet    fs.temp    fs.temp    fs.teOALESCE(fs.amount_net, 0::numeric) > 0::numeric AS is_real_client,
    'financial_settlement'::text AS source_record_type
  FROM public.financial_settlements fs
  WHERE EXTRACT(year FROM fs.settled_at) >= 2024
    AND fs.source_system = 'doctoralia'
),
unioned AS (
  SELECT * FROM social_leads
  UNION ALL
  SELECT * FROM other_financial
),
classified AS (
  SELECT
    u.*,
    row_number() OVER (
      PARTITION BY u.channel_group, u.identity_key
      ORDER BY u.event_at
    ) AS rn_by_channel,
    row_number() OVER (
      PARTITION BY u.identity_key
      ORDER BY u.event_at
    ) AS rn_global
  FROM unioned u
  WHERE u.identity_key IS NOT NULL
)
SELECT
  record_id,
  event_at,
  month,
  month_key,
  channel_group,
  channel_source,
  campaign_name,
  client_name,
  phone_normalized,
  email_normalized,
  treatment_name,
  revenue,
  is_real_client,
  rn_by_channel = 1 AND is_real_client AS is_new_client_by_channel,
  rn_global = 1 AND is_real_client AS is_new_client_global,
  source_record_type
FROM classified;

GRANT SELECT ON public.v_new_clients_by_channel_detail TO authenticated, service_role;

CREATE OR REPLACE VIEW puCREATE OR REPLACE VIEW puCREATE Othly
WITH (security_invoker = true) AS
SELECT
  month_key,
  channel_group,
  channel_source,
  campaign_name,
  COUNT(DISTINCT record_id) AS client_touchpoints_unique,
  COUNT(DISTINC  record_id) FILTER  CHERE is_real_cl  COUNTS real_clients_un  COUNT(DOUNT(DISTINCT record_id) FILTER (WHERE is_  COUNT(DISTI_channel) AS   COUNT(Dts_unique_by_channel,
  COUNT(DISTINCT   COUNT(DISTINCT   COUNT(is_new_client_global) AS new_clients_unique_global,
                  revenue,
  ROUND(
    100.0 * COUNT(DISTINCT record_id) FILTER (WHERE is_real_c  ent)
    /     /     /    STINCT record_id), 0),
    2
  ) AS client_conversion_rate_pct
FROM public.v_new_clients_by_FROM public.vl
GROGROGROGROth_key, channel_grouGROGROGROGROth_key, channel_grouGROGROGROGROth_key, channel_grouGRieGROGROGROGROth_key, channel_grouGROGROGROGROth_keyole;
