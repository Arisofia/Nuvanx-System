-- =============================================================================
-- Migration: 20260610231500_fix_doctoralia_pending_review_status_drift.sql
-- Description: Reconcile Supabase production drift with approved Doctoralia sequence logic.
--
-- Rules enforced:
--   - First valid/non-cancelled appointment = agendado.
--   - Second valid appointment with is_jjrt = true = convertido.
--   - Second valid appointment without is_jjrt = true = pendiente_revision.
--   - Third valid appointment or later = recurrente.
--   - Cancelled appointments do not advance status.
--   - Do not use leads.stage or financial_settlements for sequence classification.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_doctoralia_appointment_sequence
WITH (security_invoker = true) AS
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

CREATE OR REPLACE VIEW public.v_lead_status_auto_consolidated
WITH (security_invoker = true) AS
WITH lead_best_doctoralia AS (
    SELECT
        lead_id,
        doctoralia_auto_status,
        match_type,
        match_confidence,
        doctoralia_appointment_date,
        ROW_NUMBER() OVER (
            PARTITION BY lead_id
            ORDER BY
                CASE
                    WHEN doctoralia_auto_status = 'recurrente' THEN 4
                    WHEN doctoralia_auto_status = 'convertido' THEN 3
                    WHEN doctoralia_auto_status = 'pendiente_revision' THEN 2
                    WHEN doctoralia_auto_status = 'agendado' THEN 1
                    ELSE 0
                END DESC,
                doctoralia_appointment_date DESC
        ) AS lead_match_rank
    FROM public.v_doctoralia_lead_best_match
)
SELECT
    l.id AS lead_id,
    l.name AS lead_name,
    l.campaign_id,
    l.campaign_name,
    l.stage AS crm_stage_raw,
    l.appointment_date AS crm_appointment_date,
    l.verified_revenue AS crm_verified_revenue,
    bm.doctoralia_auto_status,
    bm.match_type,
    bm.match_confidence,
    CASE
        WHEN bm.doctoralia_auto_status IN ('recurrente','convertido','pendiente_revision','agendado') THEN bm.doctoralia_auto_status
        ELSE l.stage
    END AS consolidated_lead_status,
    CASE
        WHEN bm.lead_id IS NOT NULL THEN 'doctoralia_match'
        ELSE 'crm_fallback'
    END AS status_source,
    CASE
        WHEN bm.lead_id IS NOT NULL THEN 'Matched via ' || bm.match_type || ' with confidence ' || bm.match_confidence
        ELSE 'No reliable Doctoralia match found.'
    END AS status_reason
FROM public.leads l
LEFT JOIN lead_best_doctoralia bm ON l.id = bm.lead_id AND bm.lead_match_rank = 1
WHERE l.deleted_at IS NULL;

GRANT SELECT ON public.v_doctoralia_appointment_sequence TO authenticated, service_role;
GRANT SELECT ON public.v_doctoralia_patient_auto_status TO authenticated, service_role;
GRANT SELECT ON public.v_lead_status_auto_consolidated TO authenticated, service_role;

COMMIT;
