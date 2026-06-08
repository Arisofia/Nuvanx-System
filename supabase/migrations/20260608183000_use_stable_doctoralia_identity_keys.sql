-- Use stable identity keys for Doctoralia reporting.
-- Names are mutable in Doctoralia. Identity must prioritize patient_id / phone.

CREATE OR REPLACE VIEW public.v_new_clients_by_channel_detail
WITH (security_invoker = true) AS
WITH social_leads AS (
  SELECT
    l.id::text AS record_id,
    l.appointment_date AS event_at,
    date_trunc('month', l.appointment_date)::date AS month,
    to_char(date_trunc('month', l.appointment_date), 'YYYY-MM') AS month_key,
    l.user_id,
    l.clinic_id,
    'social'::text AS channel_group,
    COALESCE(l.source, 'meta_leadgen')::text AS channel_source,
    COALESCE(l.campaign_name, 'Sin campaña')::text AS campaign_name,
    NULLIF(TRIM(l.name), '')::text AS client_name,
    l.phone_normalized::text AS phone_normalized,
    l.email_normalized::text AS email_normalized,
    lower    lower    lower    lower  NU    lower   _no    lower    lower    lmai    lower    lower    lower    lower  NU    lower   _no    lower    lower    lmai    lower  
            ' || l.id::text
    )) AS identity_key,
    l.treatment_name::text AS treatment_name,
    COALESCE(l.verified_revenue, 0::numeric) AS revenue,
    COALESCE(l.verified_revenue, 0::numeric) > 0::numeric AS is_real_cli    COALESCE(l.verified_revenue AS    COALESCE(l_type
  F  F  F lic.leads l
  WHERE l.deleted_a  WHERE l.deleted_a  WHERE l.de_date  WHERE l.deleted_a  WHERE l.deleted_a  WHERE l.de_date  W1'  WHERE l.deleted_a  WHERE l.deleted_a  WHERE l.de_date  WHERE l.delfs.settled  WHERE l.nt_at  WHERE l.deletc(  WHERE l.deleted_a  WHERE l. AS mont  WHERE l.deleted_a  WHERE l.deleted_a  WHERE l.de_date  WH') AS  WHERE l.deleted_a  WHERE l.deleted_a  WHERE l.de_date  WHERE l.de'::  WHERE l.deleted_a  WHERE l.deleted_a  WHERE l.dtem, 'doctoralia')::text AS channel_source,
    COALESCE(fs.agenda_name, fs.intermediary_name, fs.template_name, 'Doctoralia / otros')::text AS campaign_name,
    COALESCE(
      CASE
        WHEN NULLIF(TRIM(COALESCE(fs.patient_name, '')), '') IS NOT NULL
         AND lower(TRIM(fs.patient_name)) NOT LIKE '%cambiar%'
         AND lower(TRIM(fs.patient_name)) NOT LIKE '%nuvanx%'
         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fsT          AND lower(T           AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fsT          AND lower(T           AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fsT          AND lower(T           AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOcl         AND lower(TRIM(fs.patient_name)) NOT LIK         AND lower(TRIM(fs.patient_name)) NOT LIK         AND loPa         ANDom   '
    ):    ):    ):    ):    ):    ):    ):    ):    ):    ):    ):    ):   ed,
    ):    ):    ):    ):    ):    ):    ):    ):    ):    ):  C    ):    ):    ):    ):    ):    ):    ):    ):    ):    t:' || fs.patient_id::text END,
      'phone:' || NULLIF(fs.phone_normalized, ''),
      'phone:' || NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\D', '', 'g'), ''),
      'patient_ref:' || NULLIF(fs.patient_dni::text, ''),
      'settlement:' || fs.id::text
    )) AS identity_key,
    fs.template_name::text AS treatment_name,
    COALESCE(fs.amount_net, 0::numeric) AS revenue,
    COALESCE(fs.amount_net, 0::numeric) > 0::numeric AS is_real_client,
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
SESESE
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
  is_real_client,
  rn_by_channel = 1 AND is_real_client AS is_new_client_by_channel,
  rn_global = 1 AND is_real_client AS is_new_client_global,
  source_record_type
FROM classified;

GRANT SELECT ON public.v_new_clients_by_channel_detail TO authenticated, service_role;
