-- Migration: 20260610214500_create_doctoralia_sequence_auto_status_views.sql
-- Description: Create views for automatic classification of leads/patients based on Doctoralia appointment sequence.
-- Rules:
--   1st appointment -> agendado
--   2nd appointment AND is_jjrt -> convertido
--   2nd appointment AND NOT is_jjrt -> pendiente_revision
--   3rd+ appointment -> recurrente
-- Identity Key: phone_normalized > patient_name normalized > doctoralia_id

BEGIN;

-- Ensure normalize_person_name exists as an alias for normalize_name if it doesn't already
CREATE OR REPLACE FUNCTION public.normalize_person_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN public.normalize_name(p_name);
END;
$$;

-- 1. Create the detailed appointment sequence view
CREATE OR REPLACE VIEW public.v_doctoralia_appointment_sequence AS
WITH source_rows AS (
  SELECT
    id,
    sheet_row,
    estado,
    appointment_date,
    appointment_time,
    created_date,
    created_time,
    subject,
    agenda,
    room,
    confirmed,
    origin,
    amount,
    normalized_date,
    doctoralia_id,
    patient_name,
    phone,
    phone_normalized,
    treatment,
    clinic,
    COALESCE(is_cancelled, false) AS is_cancelled,
    COALESCE(is_jjrt, false) AS is_jjrt,
    COALESCE(is_nursing, false) AS is_nursing,
    COALESCE(is_control, false) AS is_control,
    imported_at,
    updated_at,
    appointment_id,
    appointment_type,
    notes,
    patient_email,
    patient_phone,
    source_key,
    status,
    COALESCE(
      NULLIF(phone_normalized, ''),
      NULLIF(public.normalize_person_name(patient_name), ''),
      NULLIF(doctoralia_id, '')
    ) AS identity_key
  FROM public.doctoralia_appointments_ingestion
),
valid_ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY identity_key
      ORDER BY appointment_date NULLS LAST, created_date NULLS LAST, id
    ) AS valid_appointment_sequence_number,
    LAG(appointment_date) OVER (
      PARTITION BY identity_key
      ORDER BY appointment_date NULLS LAST, created_date NULLS LAST, id
    ) AS previous_valid_appointment_date
  FROM source_rows
  WHERE identity_key IS NOT NULL
    AND is_cancelled IS NOT TRUE
),
patient_rollup AS (
  SELECT
    identity_key,
    MIN(created_date) FILTER (WHERE is_cancelled IS NOT TRUE) AS first_seen_date,
    MIN(appointment_date) FILTER (WHERE is_cancelled IS NOT TRUE) AS first_appointment_date,
    MAX(appointment_date) FILTER (WHERE is_cancelled IS NOT TRUE) AS last_appointment_date,
    COUNT(*) FILTER (WHERE is_cancelled IS NOT TRUE) AS total_valid_appointments,
    COUNT(*) FILTER (WHERE is_cancelled IS TRUE) AS total_cancelled_appointments,
    BOOL_OR(is_jjrt IS TRUE AND is_cancelled IS NOT TRUE) AS has_jjrt_appointment,
    BOOL_OR(is_control IS TRUE AND is_cancelled IS NOT TRUE) AS has_control_appointment
  FROM source_rows
  WHERE identity_key IS NOT NULL
  GROUP BY identity_key
)
SELECT
  s.*,
  v.valid_appointment_sequence_number,
  v.previous_valid_appointment_date,
  p.first_seen_date,
  p.first_appointment_date,
  p.last_appointment_date,
  p.total_valid_appointments,
  p.total_cancelled_appointments,
  p.has_jjrt_appointment,
  p.has_control_appointment,
  CASE
    WHEN s.is_cancelled IS TRUE THEN 'cancelado'
    WHEN v.valid_appointment_sequence_number >= 3 THEN 'recurrente'
    WHEN v.valid_appointment_sequence_number = 2 AND s.is_jjrt IS TRUE THEN 'convertido'
    WHEN v.valid_appointment_sequence_number = 2 THEN 'pendiente_revision'
    WHEN v.valid_appointment_sequence_number = 1 THEN 'agendado'
    ELSE 'sin_clasificar'
  END AS auto_status,
  CASE
    WHEN s.is_cancelled IS TRUE THEN -1
    WHEN v.valid_appointment_sequence_number >= 3 THEN 4
    WHEN v.valid_appointment_sequence_number = 2 AND s.is_jjrt IS TRUE THEN 3
    WHEN v.valid_appointment_sequence_number = 2 THEN 2
    WHEN v.valid_appointment_sequence_number = 1 THEN 1
    ELSE 0
  END AS auto_status_rank,
  CASE
    WHEN s.is_cancelled IS TRUE THEN 'Cita anulada/cancelada: no avanza estado.'
    WHEN v.valid_appointment_sequence_number >= 3 THEN 'Tercera cita válida o posterior: recurrente.'
    WHEN v.valid_appointment_sequence_number = 2 AND s.is_jjrt IS TRUE THEN 'Segunda cita válida en agenda JJRT: convertido.'
    WHEN v.valid_appointment_sequence_number = 2 THEN 'Segunda cita válida sin JJRT: pendiente de revisión.'
    WHEN v.valid_appointment_sequence_number = 1 THEN 'Primera cita válida/primera aparición: agendado.'
    ELSE 'Sin identidad suficiente para secuencia.'
  END AS auto_status_reason
FROM source_rows s
LEFT JOIN valid_ranked v ON v.id = s.id
LEFT JOIN patient_rollup p ON p.identity_key = s.identity_key;

-- 2. Create the patient-level auto-status view
CREATE OR REPLACE VIEW public.v_doctoralia_patient_auto_status AS
WITH ranked AS (
  SELECT
    identity_key,
    MAX(auto_status_rank) AS max_status_rank,
    MAX(total_valid_appointments) AS total_valid_appointments,
    MAX(total_cancelled_appointments) AS total_cancelled_appointments,
    MIN(first_seen_date) AS first_seen_date,
    MIN(first_appointment_date) AS first_appointment_date,
    MAX(last_appointment_date) AS last_appointment_date,
    BOOL_OR(has_jjrt_appointment) AS has_jjrt_appointment,
    BOOL_OR(has_control_appointment) AS has_control_appointment
  FROM public.v_doctoralia_appointment_sequence
  WHERE identity_key IS NOT NULL
  GROUP BY identity_key
)
SELECT
  identity_key,
  first_seen_date,
  first_appointment_date,
  last_appointment_date,
  total_valid_appointments,
  total_cancelled_appointments,
  has_jjrt_appointment,
  has_control_appointment,
  CASE max_status_rank
    WHEN 4 THEN 'recurrente'
    WHEN 3 THEN 'convertido'
    WHEN 2 THEN 'pendiente_revision'
    WHEN 1 THEN 'agendado'
    WHEN 0 THEN 'sin_clasificar'
    ELSE 'cancelado'
  END AS patient_auto_status,
  max_status_rank AS patient_auto_status_rank
FROM ranked;

-- 3. Set security and grants
ALTER VIEW public.v_doctoralia_appointment_sequence SET (security_invoker = true);
ALTER VIEW public.v_doctoralia_patient_auto_status SET (security_invoker = true);

GRANT SELECT ON public.v_doctoralia_appointment_sequence TO authenticated, service_role;
GRANT SELECT ON public.v_doctoralia_patient_auto_status TO authenticated, service_role;

COMMIT;
