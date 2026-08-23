-- Companion to 20260823094650_prepare_doctoralia_phone_type_replay.sql.
--
-- Only a clean replay creates public._nvx_replay_20260823094700. Production did
-- not create the marker because 094700 is already recorded there, so this file
-- is a production no-op even when applied out of order with --include-all.

DO $$
BEGIN
  IF to_regclass('public._nvx_replay_20260823094700') IS NULL THEN
    RETURN;
  END IF;

  CREATE VIEW public.vw_doctoralia_trazabilidad_360
  WITH (security_invoker = true)
  AS
  SELECT
    clinic_id,
    upload_id,
    source_file_id,
    sheet_name,
    estado,
    lower(btrim(COALESCE(estado, ''::varchar)::text)) AS estado_norm,
    fecha,
    hora,
    fecha_creacion,
    hora_creacion,
    timestamp_cita,
    timestamp_creacion,
    lead_time_days,
    lead_time_hours,
    fecha_mes,
    fecha_ano,
    trimestre,
    dia_semana,
    hora_inicio,
    franja_horaria,
    asunto,
    agenda,
    sala_box,
    confirmada,
    procedencia,
    importe_numerico,
    importe_clean,
    is_ingreso,
    cita_efectiva,
    cita_perdida,
    paciente_id,
    paciente_nombre,
    paciente_telefono,
    procedimiento_nombre,
    patient_name_norm,
    phone_primary,
    phone_secondary,
    treatment
  FROM public.doctoralia_raw;

  CREATE VIEW public.vw_doctoralia_lead_traceability_unified
  WITH (security_invoker = true)
  AS
  SELECT
    dr.clinic_id,
    dr.upload_id,
    dr.source_file_id,
    dr.sheet_name,
    dr.estado,
    dr.estado_norm,
    dr.fecha,
    dr.hora,
    dr.fecha_creacion,
    dr.hora_creacion,
    dr.timestamp_cita,
    dr.timestamp_creacion,
    dr.lead_time_days,
    dr.lead_time_hours,
    dr.fecha_mes,
    dr.fecha_ano,
    dr.trimestre,
    dr.dia_semana,
    dr.hora_inicio,
    dr.franja_horaria,
    dr.asunto,
    dr.agenda,
    dr.sala_box,
    dr.confirmada,
    dr.procedencia,
    dr.importe_numerico,
    dr.importe_clean,
    dr.is_ingreso,
    dr.cita_efectiva,
    dr.cita_perdida,
    dr.paciente_id,
    dr.paciente_nombre,
    dr.paciente_telefono,
    dr.procedimiento_nombre,
    dr.patient_name_norm,
    dr.phone_primary,
    dr.phone_secondary,
    dr.treatment,
    COALESCE(
      public.normalize_phone(dr.paciente_telefono::text),
      public.normalize_phone(dr.phone_primary::text),
      public.normalize_phone(dr.phone_secondary::text)
    ) AS paciente_telefono_normalized,
    l.id AS lead_id,
    l.external_id AS leadgen_id,
    l.name AS lead_full_name,
    l.phone AS lead_phone,
    l.phone_normalized AS lead_phone_normalized,
    l.source AS lead_source,
    l.stage AS lead_stage,
    l.created_at AS lead_created_at,
    COALESCE(m.campaign_name, l.campaign_name) AS campaign_name,
    COALESCE(m.ad_name, l.ad_name) AS ad_name,
    l.form_name,
    m.campaign_id,
    m.adset_id,
    m.adset_name,
    m.ad_id,
    l.revenue AS lead_revenue_estimated,
    l.verified_revenue AS lead_revenue_verified,
    COALESCE(dr.estado::text, l.appointment_status) AS appointment_status,
    COALESCE(dr.timestamp_cita, l.attended_at) AS attended_at,
    COALESCE(
      CASE WHEN dr.estado::text = 'No presentado'::text THEN true ELSE NULL::boolean END,
      l.no_show_flag
    ) AS no_show_flag,
    l.converted_patient_id AS lead_converted_patient_id,
    l.priority AS lead_priority,
    l.fbc AS lead_fbc,
    l.fbp AS lead_fbp
  FROM public.vw_doctoralia_trazabilidad_360 dr
  LEFT JOIN public.leads l
    ON public.normalize_phone(dr.paciente_telefono::text) = l.phone_normalized
    OR public.normalize_phone(dr.phone_primary::text) = l.phone_normalized
    OR public.normalize_phone(dr.phone_secondary::text) = l.phone_normalized
  LEFT JOIN public.meta_attribution m
    ON m.lead_id = l.id;

  CREATE VIEW public.vw_doctoralia_patient_ltv
  WITH (security_invoker = true)
  AS
  SELECT
    paciente_telefono_normalized,
    paciente_telefono,
    paciente_id,
    paciente_nombre,
    procedimiento_nombre,
    count(*) AS total_citas,
    count(*) FILTER (WHERE cita_efectiva) AS citas_efectivas,
    count(*) FILTER (WHERE cita_perdida) AS citas_perdidas,
    round(COALESCE(sum(importe_numerico) FILTER (WHERE cita_efectiva), 0::numeric), 2) AS ingresos_totales,
    round(COALESCE(sum(importe_numerico), 0::numeric), 2) AS ingresos_brutos,
    count(DISTINCT campaign_name) AS "campañas_distintas",
    array_remove(array_agg(DISTINCT campaign_name), NULL::text) AS campaign_names,
    array_remove(array_agg(DISTINCT ad_name), NULL::text) AS ad_names,
    array_remove(array_agg(DISTINCT form_name), NULL::text) AS form_names,
    min(timestamp_cita) AS primera_cita,
    max(timestamp_cita) AS ultima_cita,
    min(lead_created_at) AS primera_captacion,
    max(lead_created_at) AS ultima_captacion,
    avg(lead_time_days) AS promedio_lead_time_dias
  FROM public.vw_doctoralia_lead_traceability_unified
  GROUP BY
    paciente_telefono_normalized,
    paciente_telefono,
    paciente_id,
    paciente_nombre,
    procedimiento_nombre;

  -- Restore the read surface needed by preview/application roles. Later security
  -- migrations remain authoritative for any additional hardening.
  GRANT SELECT ON public.vw_doctoralia_trazabilidad_360 TO anon, authenticated, service_role;
  GRANT SELECT ON public.vw_doctoralia_lead_traceability_unified TO anon, authenticated, service_role;
  GRANT SELECT ON public.vw_doctoralia_patient_ltv TO anon, authenticated, service_role;

  COMMENT ON COLUMN public.vw_doctoralia_lead_traceability_unified.lead_fbc IS
    'Meta fbc (fbclid) captured at lead time - critical for CAPI EMQ';
  COMMENT ON COLUMN public.vw_doctoralia_lead_traceability_unified.lead_fbp IS
    'Meta fbp (_fbp) captured at lead time - critical for CAPI EMQ';

  DROP TABLE public._nvx_replay_20260823094700;
END
$$;
