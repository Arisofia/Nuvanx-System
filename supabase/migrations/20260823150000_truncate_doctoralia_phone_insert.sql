-- Fix SQLSTATE 22001 (value too long for type character varying(32)) 
-- by truncating the source phone number before insertion into doctoralia_raw.
-- This addresses the sourcery-ai bug_risk comment on PR 209 without
-- needing to alter the locked column type or drop view dependencies.

BEGIN;

CREATE OR REPLACE FUNCTION public.nvx_upsert_doctoralia_live_row(p_source_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.doctoralia_appointments_ingestion%ROWTYPE;
  v_clinic_id uuid;
  v_confirmed boolean;
  v_appointment_ts timestamptz;
BEGIN
  SELECT *
    INTO v_row
  FROM public.doctoralia_appointments_ingestion
  WHERE source_key = p_source_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_clinic_id := public.nvx_resolve_doctoralia_live_clinic_id();
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'No clinic is configured for Doctoralia LIVE projection';
  END IF;

  v_confirmed := CASE
    WHEN v_row.confirmed IS NULL THEN NULL
    ELSE lower(trim(v_row.confirmed)) IN ('si', 'sí', 'yes', 'true', '1', 'confirmada', 'confirmado')
  END;

  v_appointment_ts := public.nvx_doctoralia_live_timestamp(
    COALESCE(v_row.appointment_date, v_row.normalized_date),
    v_row.appointment_time
  );

  INSERT INTO public.doctoralia_raw (
    clinic_id,
    raw_row,
    processed,
    processed_at,
    raw_hash,
    ingested_at,
    source_file_id,
    sheet_name,
    estado,
    fecha,
    hora,
    fecha_creacion,
    asunto,
    agenda,
    sala_box,
    confirmada,
    procedencia,
    importe,
    doc_patient_id,
    patient_name,
    patient_name_norm,
    phone_primary,
    treatment,
    appointment_start,
    timestamp_cita,
    importe_numerico,
    importe_clean,
    is_ingreso,
    cita_efectiva,
    cita_perdida,
    paciente_id,
    paciente_nombre,
    paciente_telefono,
    procedimiento_nombre,
    updated_at
  ) VALUES (
    v_clinic_id,
    COALESCE(v_row.raw_data, '{}'::jsonb) || jsonb_build_object(
      'source_key', v_row.source_key,
      'canonical_table', 'doctoralia_appointments_ingestion',
      'sheet_row', v_row.sheet_row
    ),
    true,
    COALESCE(v_row.updated_at, v_row.imported_at, now()),
    'ingestion:' || md5(v_row.source_key),
    v_row.imported_at,
    v_row.source_key,
    'canonical_appointments_ingestion',
    v_row.estado,
    COALESCE(v_row.appointment_date, v_row.normalized_date),
    v_row.appointment_time,
    v_row.created_date,
    COALESCE(v_row.subject, v_row.treatment),
    v_row.agenda,
    v_row.room,
    v_confirmed,
    v_row.origin,
    v_row.amount,
    v_row.doctoralia_id,
    v_row.patient_name,
    upper(trim(COALESCE(v_row.patient_name, ''))),
    left(COALESCE(v_row.phone_normalized, v_row.phone, v_row.patient_phone), 32),
    v_row.treatment,
    v_appointment_ts,
    v_appointment_ts,
    v_row.amount,
    v_row.amount,
    COALESCE(v_row.amount, 0) > 0,
    NOT COALESCE(v_row.is_cancelled, false),
    COALESCE(v_row.is_cancelled, false),
    v_row.doctoralia_id,
    v_row.patient_name,
    left(COALESCE(v_row.phone_normalized, v_row.phone, v_row.patient_phone), 32),
    v_row.treatment,
    COALESCE(v_row.updated_at, v_row.imported_at, now())
  )
  ON CONFLICT (raw_hash) WHERE raw_hash IS NOT NULL
  DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    raw_row = EXCLUDED.raw_row,
    processed = EXCLUDED.processed,
    processed_at = EXCLUDED.processed_at,
    ingested_at = EXCLUDED.ingested_at,
    source_file_id = EXCLUDED.source_file_id,
    sheet_name = EXCLUDED.sheet_name,
    estado = EXCLUDED.estado,
    fecha = EXCLUDED.fecha,
    hora = EXCLUDED.hora,
    fecha_creacion = EXCLUDED.fecha_creacion,
    asunto = EXCLUDED.asunto,
    agenda = EXCLUDED.agenda,
    sala_box = EXCLUDED.sala_box,
    confirmada = EXCLUDED.confirmada,
    procedencia = EXCLUDED.procedencia,
    importe = EXCLUDED.importe,
    doc_patient_id = EXCLUDED.doc_patient_id,
    patient_name = EXCLUDED.patient_name,
    patient_name_norm = EXCLUDED.patient_name_norm,
    phone_primary = EXCLUDED.phone_primary,
    treatment = EXCLUDED.treatment,
    appointment_start = EXCLUDED.appointment_start,
    timestamp_cita = EXCLUDED.timestamp_cita,
    importe_numerico = EXCLUDED.importe_numerico,
    importe_clean = EXCLUDED.importe_clean,
    is_ingreso = EXCLUDED.is_ingreso,
    cita_efectiva = EXCLUDED.cita_efectiva,
    cita_perdida = EXCLUDED.cita_perdida,
    paciente_id = EXCLUDED.paciente_id,
    paciente_nombre = EXCLUDED.paciente_nombre,
    paciente_telefono = EXCLUDED.paciente_telefono,
    procedimiento_nombre = EXCLUDED.procedimiento_nombre,
    updated_at = EXCLUDED.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_upsert_doctoralia_live_row(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_upsert_doctoralia_live_row(text) TO service_role;

COMMIT;
