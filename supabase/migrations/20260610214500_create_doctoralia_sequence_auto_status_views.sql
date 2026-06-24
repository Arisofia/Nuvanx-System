-- =============================================================================
-- Migration: 20260610214500_create_doctoralia_sequence_auto_status_views.sql
-- Description: Create auditable Doctoralia sequence views for automatic lead/patient status.
--
-- Business rules:
--   - First valid/non-cancelled appointment = agendado.
--   - Second valid appointment with is_jjrt = true = convertido.
--   - Second valid appointment without is_jjrt = true = pendiente_revision.
--   - Third valid appointment or later = recurrente.
--   - Cancelled appointments do not advance status.
--   - Do not use leads.stage or financial_settlements for this classification.
--   - Do not mutate source tables.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_person_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_name(p_name);
$$;

-- Compatibility alias for Doctoralia matching views; delegates to the canonical normalize_name function.

CREATE OR REPLACE VIEW public.v_doctoralia_appointment_sequence
WITH (security_invoker = true) AS
WITH source_rows AS (
    SELECT
        id,
        source_key,
        sheet_row,
        appointment_id,
        patient_name,
        patient_email,
        patient_phone,
        appointment_date,
        appointment_type,
        status,
        notes,
        estado,
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
        phone,
        phone_normalized,
        treatment,
        day_num,
        month_num,
        year_num,
        clinic,
        COALESCE(is_cancelled, false) AS is_cancelled,
        COALESCE(is_jjrt, false) AS is_jjrt,
        COALESCE(is_nursing, false) AS is_nursing,
        COALESCE(is_control, false) AS is_control,
        raw_data,
        inserted_at,
        imported_at,
        updated_at,
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

COMMENT ON VIEW public.v_doctoralia_appointment_sequence IS
'Vista auditable de secuencia Doctoralia. Clasifica cada cita por orden real no cancelado: primera=agendado, segunda JJRT=convertido, segunda no JJRT=pendiente_revision, tercera+=recurrente. No usa leads.stage ni pagos.';

CREATE OR REPLACE VIEW public.v_doctoralia_patient_auto_status
WITH (security_invoker = true) AS
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

COMMENT ON VIEW public.v_doctoralia_patient_auto_status IS
'Estado automático por paciente Doctoralia. La precedencia conserva el mayor avance: recurrente > convertido > pendiente_revision > agendado. Cancelaciones no bajan estado histórico.';

GRANT SELECT ON public.v_doctoralia_appointment_sequence TO authenticated, service_role;
GRANT SELECT ON public.v_doctoralia_patient_auto_status TO authenticated, service_role;

COMMIT;
