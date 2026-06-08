-- Recreate channel conversion views to fix Doctoralia patient names.
-- Required because CREATE OR REPLACE VIEW cannot drop existing columns.

DROP VIEW IF EXISTS public.v_new_clients_by_channel_monthly CASCADE;
DROP VIEW IF EXISTS public.v_new_clients_by_channel_detail CASCADE;

CREATE VIEW public.v_new_clients_by_channel_detail
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
    l.phone_normalized::text AS phone_n    l.phone_normalized::textlized::text AS email_normalized,
    lower(COALESCE(
      NULLIF(l.phone_normalized, ''),
      NULL      NULL      NULL      NULL      NULL      NULL      NULL   t, ''),      NULL      NULL      NULL      NULL      NULL      NULL      ty_key,
      NULL      NULL      NULL      NULL      NULL      NULL verified      NULL      NULL      NULL      NULL      NULL      NULL verif 0:      NULL      NULL      NULL      NULL      NULad      NULL      NULL      NULL  rd_type
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND l.appointment_date IS NOT NULL
    AND l.appointment_date >= date '2024-01-01'
),
other_finaother_finaother_finaother_finaother_finaother_finaother_finaother_finaother__aother_finao_trunc('month', fs.settled_at)::date AS month,
    to_char(date_trunc('month', fs.settled_at), 'YYYY-MM') AS month_key,
    NULL::uuid AS user_id,
    fs.clinic_id,
    'other'::text AS channel_group,
    COALESCE(fs.source_system, 'doctoralia    COALESCE(fs.source_system, 'doctoralia    COALESCE(fs.source_system, 'doctoralia    COALESCE(fDoctoralia / otros')::    COALESCE(fs.soume,
    COALESCE(
      NULLIF(TRIM(fs.patient_name), ''),
      NULLIF(TRIM(fs.template_patient_name), ''),
      NULLIF(TRIM(fs.patient_phone), ''),
      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no      'Paciente sin no     nt_phone, ''), '\D', '', 'g'), ''),
      NULLIF(fs.pat      NULLIF(fs.pat      NULLIF(fs.papa      NULLIF(fs.pat      NULLIF(fs.pat      Nte_ at      NULLIF(fs.pat      NULLIF(fs.pat      NULLIF(fs.papa      NULLIF(fs.pat      NULLIF(fs.pat      Nte_ at      NULLIF(fs.pat      NULLIF(fs.er      NULLIF(fs.pat      NULLIF(fs.pat      NULLIF(fs.papa      NULLIFS i      NULLIF(fs.pat      ci     ttlement'::te      NULLIF(fs.pat      NULLIF(fsblic.financial_settlements fs
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
    u.    u.    u.    u.    u.    u.    u.    u.    u.channel_group, u.identity_key
      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY gr      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY gr      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER BY      ORDER an      ORDER BY      ORDER BY      ORDER BY   
SELSELSELSELSELSELSELSELSr_id,
  clinic_id,
  channel_group,
  channel_source,
  campaign_name,
  CO  CO  CO  CO  CO  CO  CO  CO  ent_touchpoints_uniqu  CO COUN  CO  CO  CO  CO  CO  CO  CO  CO  ent_touchpoints_uniqu  CO COUN  CO  CO  CO  CO  T(DISTINCT record_id) FILTER (WHERE is_new_client_by_channel) AS new_clients_unique_by_channel,
  COUNT(DISTINCT record_id) FILTER (WHERE is_new_client_global) AS new_clients_unique_global,
  SUM(revenue) AS revenue,
  ROUND(
    100.0 * COUNT(DISTINCT record_id) FILTER (WHERE is_real_client)
    / NULLIF(COUNT(DISTINCT record_id), 0),
    2
  ) AS client_conversion_rate_pct
FROM public.v_new_clients_by_channel_detail
GROUP BY month_key, user_id, clinic_id, channel_group, channel_source, campaign_name;

GRANT SELECT ON public.v_new_clients_by_channel_monthly TO authenticated, service_role;
