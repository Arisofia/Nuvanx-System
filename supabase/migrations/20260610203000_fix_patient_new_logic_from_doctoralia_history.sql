-- =============================================================================
-- Migration: 20260610203000_fix_patient_new_logic_from_doctoralia_history.sql
-- Description: Separate patient new/returning logic from monetization.
-- Logic: "New" depends on the first appearance in Doctoralia history.
-- Author: Zencoder (Coding Agent)
-- Date: 2026-06-10
-- =============================================================================

BEGIN;

-- 1. Create v_doctoralia_patient_history
-- Aggregates patient information by a stable identity_key.
CREATE OR REPLACE VIEW public.v_doctoralia_patient_history AS
WITH patient_identity AS (
    SELECT
        COALESCE(doctoralia_id, phone_normalized, public.normalize_name(patient_name)) as identity_key,
        doctoralia_id,
        phone_normalized,
        patient_name,
        created_date,
        appointment_date,
        is_cancelled,
        is_control,
        amount as doctoralia_amount
    FROM public.doctoralia_appointments_ingestion
)
SELECT
    identity_key,
    MIN(COALESCE(created_date, appointment_date)) as first_seen_at,
    MIN(appointment_date) as first_appointment_at,
    MAX(appointment_date) as last_appointment_at,
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE is_cancelled IS NOT TRUE) as effective_appointments,
    COUNT(*) FILTER (WHERE is_control IS TRUE) as control_appointments,
    -- Keep track of identifiers for matching
    MAX(doctoralia_id) as last_doctoralia_id,
    MAX(phone_normalized) as last_phone_normalized,
    MAX(patient_name) as last_patient_name
FROM patient_identity
GROUP BY identity_key;

-- 2. Create v_doctoralia_patient_appointment_classification
-- Classifies each individual appointment based on its order and status.
CREATE OR REPLACE VIEW public.v_doctoralia_patient_appointment_classification AS
WITH ranked_appointments AS (
    SELECT
        id,
        source_key,
        COALESCE(doctoralia_id, phone_normalized, public.normalize_name(patient_name)) as identity_key,
        doctoralia_id,
        patient_name,
        phone_normalized,
        appointment_date,
        created_date,
        treatment,
        is_cancelled,
        is_control,
        status,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(doctoralia_id, phone_normalized, public.normalize_name(patient_name))
            ORDER BY appointment_date ASC NULLS LAST, created_date ASC NULLS LAST, id ASC
        ) as appointment_rank_global,
        CASE
            WHEN is_cancelled IS NOT TRUE AND is_control IS NOT TRUE THEN
                SUM(
                    CASE WHEN is_cancelled IS NOT TRUE AND is_control IS NOT TRUE THEN 1 ELSE 0 END
                ) OVER (
                    PARTITION BY COALESCE(doctoralia_id, phone_normalized, public.normalize_name(patient_name))
                    ORDER BY appointment_date ASC NULLS LAST, created_date ASC NULLS LAST, id ASC
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )
            ELSE NULL
        END as appointment_rank_effective
    FROM public.doctoralia_appointments_ingestion
)
SELECT
    *,
    CASE
        WHEN is_cancelled IS TRUE THEN 'cancelled'
        WHEN is_control IS TRUE THEN 'control'
        WHEN appointment_date > CURRENT_DATE AND is_cancelled IS NOT TRUE THEN 'future_scheduled'
        WHEN appointment_rank_effective = 1 THEN 'new'
        WHEN appointment_rank_effective > 1 THEN 'returning'
        ELSE 'unknown'
    END as patient_type
FROM ranked_appointments;

-- 3. Replace v_patient_conversion_detail
-- Joins leads with Doctoralia history and revenue.
DROP VIEW IF EXISTS public.v_patient_conversion_detail CASCADE;
CREATE OR REPLACE VIEW public.v_patient_conversion_detail AS
WITH lead_doctoralia_match AS (
    SELECT
        l.id as lead_id,
        l.name as lead_name,
        l.phone_normalized as lead_phone,
        l.created_at as lead_created_at,
        l.source as lead_source,
        l.campaign_name as lead_campaign,
        l.appointment_date as lead_appointment_date,
        l.verified_revenue as crm_verified_revenue,
        l.clinic_id,
        l.user_id,
        -- Find matches in Doctoralia classification
        dac.identity_key,
        dac.patient_type,
        dac.appointment_date as doc_appointment_date,
        dac.is_cancelled,
        dac.is_control,
        dac.appointment_rank_effective,
        -- Ranked matches to avoid duplication (closest appointment to lead creation)
        ROW_NUMBER() OVER (
            PARTITION BY l.id
            ORDER BY ABS(EXTRACT(EPOCH FROM (dac.appointment_date::timestamptz - l.created_at))) ASC
        ) as match_rank
    FROM public.leads l
    LEFT JOIN public.v_doctoralia_patient_appointment_classification dac
        ON dac.phone_normalized = l.phone_normalized
           OR dac.identity_key = public.normalize_name(l.name)
    WHERE l.deleted_at IS NULL
),
revenue_summary AS (
    -- Revenue aggregated by phone to match leads (since lead_id is mostly empty)
    SELECT
        phone_normalized,
        SUM(amount_net) as total_revenue,
        COUNT(*) as payment_count,
        MAX(settled_at) as last_payment_at
    FROM public.financial_settlements
    WHERE amount_net > 0 AND cancelled_at IS NULL
    GROUP BY phone_normalized
)
SELECT
    ldm.lead_id,
    ldm.lead_name,
    ldm.lead_phone,
    ldm.lead_created_at,
    ldm.lead_source,
    ldm.lead_campaign,
    ldm.clinic_id,
    ldm.user_id,
    COALESCE(ldm.patient_type,
        CASE
            WHEN ldm.lead_appointment_date IS NOT NULL THEN 'scheduled'
            ELSE 'lead_only'
        END
    ) as status_detail,
    CASE
        WHEN ldm.patient_type = 'new' THEN 1 ELSE 0
    END as is_new_patient,
    CASE
        WHEN ldm.patient_type = 'returning' THEN 1 ELSE 0
    END as is_returning_patient,
    CASE
        WHEN ldm.patient_type = 'control' THEN 1 ELSE 0
    END as is_control_patient,
    CASE
        WHEN ldm.is_cancelled IS TRUE THEN 1 ELSE 0
    END as is_cancelled_appointment,
    CASE
        WHEN rs.payment_count > 0 THEN 1 ELSE 0
    END as is_paid_patient,
    COALESCE(rs.total_revenue, 0) as total_revenue,
    COALESCE(ldm.crm_verified_revenue, 0) as crm_verified_revenue,
    GREATEST(COALESCE(rs.total_revenue, 0), COALESCE(ldm.crm_verified_revenue, 0)) as final_revenue
FROM lead_doctoralia_match ldm
LEFT JOIN revenue_summary rs ON rs.phone_normalized = ldm.lead_phone
WHERE ldm.match_rank = 1;

-- 4. Replace v_patient_conversion_monthly
CREATE OR REPLACE VIEW public.v_patient_conversion_monthly AS
SELECT
    TO_CHAR(lead_created_at, 'YYYY-MM') as month_key,
    clinic_id,
    user_id,
    lead_source as source,
    lead_campaign as campaign,
    COUNT(*) as total_leads,
    SUM(CASE WHEN status_detail IN ('new', 'returning', 'control', 'scheduled') THEN 1 ELSE 0 END) as scheduled_valuations,
    SUM(is_new_patient) as new_patients,
    SUM(is_returning_patient) as returning_patients,
    SUM(is_control_patient) as control_appointments,
    SUM(is_paid_patient) as paid_patients,
    SUM(final_revenue) as total_revenue
FROM public.v_patient_conversion_detail
GROUP BY 1, 2, 3, 4, 5;

-- 5. Replace v_new_clients_by_channel_detail
DROP VIEW IF EXISTS public.v_new_clients_by_channel_detail CASCADE;
CREATE OR REPLACE VIEW public.v_new_clients_by_channel_detail AS
SELECT
    lead_id as record_id,
    lead_created_at as event_at,
    TO_CHAR(lead_created_at, 'YYYY-MM') as month_key,
    user_id,
    clinic_id,
    CASE
        WHEN lead_source ILIKE '%facebook%' OR lead_source ILIKE '%instagram%' OR lead_source ILIKE '%meta%' THEN 'social'
        WHEN lead_source ILIKE '%google%' OR lead_source ILIKE '%cpc%' THEN 'paid'
        ELSE 'other'
    END as channel_group,
    lead_source as channel_source,
    lead_campaign as campaign_name,
    lead_name as client_name,
    NULL::TEXT as treatment_name,
    final_revenue as revenue,
    (is_paid_patient = 1 OR is_new_patient = 1 OR is_returning_patient = 1) as is_real_client,
    (is_new_patient = 1) as is_new_client_by_channel,
    (is_new_patient = 1) as is_new_client_global,
    'lead'::text as source_record_type,
    status_detail
FROM public.v_patient_conversion_detail;

-- 6. Replace v_new_clients_by_channel_monthly
CREATE OR REPLACE VIEW public.v_new_clients_by_channel_monthly AS
SELECT
    month_key,
    user_id,
    clinic_id,
    channel_group,
    channel_source,
    campaign_name,
    COUNT(DISTINCT record_id) as total_leads,
    COUNT(DISTINCT record_id) FILTER (WHERE is_real_client) as real_clients_unique,
    COUNT(DISTINCT record_id) FILTER (WHERE is_new_client_by_channel) as new_clients_unique,
    SUM(revenue) as total_revenue,
    ROUND(100.0 * COUNT(DISTINCT record_id) FILTER (WHERE is_real_client) / NULLIF(COUNT(DISTINCT record_id), 0), 2) as conversion_rate_pct
FROM public.v_new_clients_by_channel_detail
GROUP BY 1, 2, 3, 4, 5, 6;

-- 7. Security and Grants
ALTER VIEW public.v_doctoralia_patient_history SET (security_invoker = true);
ALTER VIEW public.v_doctoralia_patient_appointment_classification SET (security_invoker = true);
ALTER VIEW public.v_patient_conversion_detail SET (security_invoker = true);
ALTER VIEW public.v_patient_conversion_monthly SET (security_invoker = true);
ALTER VIEW public.v_new_clients_by_channel_detail SET (security_invoker = true);
ALTER VIEW public.v_new_clients_by_channel_monthly SET (security_invoker = true);

GRANT SELECT ON public.v_doctoralia_patient_history TO authenticated, service_role;
GRANT SELECT ON public.v_doctoralia_patient_appointment_classification TO authenticated, service_role;
GRANT SELECT ON public.v_patient_conversion_detail TO authenticated, service_role;
GRANT SELECT ON public.v_patient_conversion_monthly TO authenticated, service_role;
GRANT SELECT ON public.v_new_clients_by_channel_detail TO authenticated, service_role;
GRANT SELECT ON public.v_new_clients_by_channel_monthly TO authenticated, service_role;

-- 8. Final comment for audit trail
COMMENT ON VIEW public.v_doctoralia_patient_appointment_classification IS 'Separates appointment classification (new/returning) from payments, based on Doctoralia ingestion history.';

COMMIT;
