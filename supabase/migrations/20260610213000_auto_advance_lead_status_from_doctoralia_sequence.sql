-- Migration: 20260610213000_auto_advance_lead_status_from_doctoralia_sequence.sql
-- Description: Auto-advance lead status based on Doctoralia appointment sequence.
-- Logic: 
--   1st valid appointment -> agendado
--   2nd valid appointment AND is_jjrt -> convertido
--   2nd valid appointment AND NOT is_jjrt -> pendiente_revision
--   3rd+ valid appointment -> recurrente
-- Identity Key: phone_normalized > patient_name normalized > doctoralia_id
-- Author: Zencoder
-- Date: 2026-06-10

BEGIN;

-- Drop existing Doctoralia sequence views before recreating them with a new column shape.
DROP VIEW IF EXISTS public.v_lead_status_classification CASCADE;
DROP VIEW IF EXISTS public.v_lead_auto_status_from_doctoralia CASCADE;
DROP VIEW IF EXISTS public.v_doctoralia_appointment_sequence CASCADE;

-- 1. Create or replace base view for appointment sequence
-- This view calculates the sequence number for each patient's appointments.
CREATE OR REPLACE VIEW public.v_doctoralia_appointment_sequence AS
WITH base_identity AS (
    SELECT 
        *,
        -- Identity key priority: phone_normalized > patient_name normalizado > doctoralia_id
        COALESCE(
            NULLIF(phone_normalized, ''), 
            public.normalize_name(patient_name), 
            NULLIF(doctoralia_id, '')
        ) as identity_key
    FROM public.doctoralia_appointments_ingestion
),
sequenced_appointments AS (
    SELECT 
        *,
        -- Only sequence non-cancelled appointments for state advancement
        CASE 
            WHEN is_cancelled IS NOT TRUE THEN
                ROW_NUMBER() OVER (
                    PARTITION BY identity_key 
                    ORDER BY appointment_date ASC, created_date ASC, id ASC
                )
            ELSE NULL
        END as appointment_sequence_number
    FROM base_identity
),
identity_stats AS (
    SELECT 
        identity_key,
        MIN(created_date) as first_seen_date,
        MIN(appointment_date) as first_appointment_date,
        COUNT(*) FILTER (WHERE is_cancelled IS NOT TRUE) as total_valid_appointments,
        BOOL_OR(is_jjrt) as has_jjrt_appointment,
        -- Check if the 2nd valid appointment was JJRT
        BOOL_OR(appointment_sequence_number = 2 AND is_jjrt) as second_valid_appointment_is_jjrt
    FROM sequenced_appointments
    GROUP BY identity_key
)
SELECT 
    sa.*,
    ist.first_seen_date,
    ist.first_appointment_date,
    LAG(sa.appointment_date) OVER (PARTITION BY sa.identity_key ORDER BY sa.appointment_date ASC, sa.created_date ASC, sa.id ASC) as previous_appointment_date,
    ist.total_valid_appointments,
    ist.has_jjrt_appointment,
    ist.second_valid_appointment_is_jjrt
FROM sequenced_appointments sa
JOIN identity_stats ist ON sa.identity_key = ist.identity_key;

-- 2. Create or replace view for auto-status classification
-- This view defines the status based on the sequence and characteristics of the appointment.
CREATE OR REPLACE VIEW public.v_lead_auto_status_from_doctoralia AS
SELECT 
    *,
    CASE 
        WHEN is_cancelled IS TRUE THEN 'cancelado'
        WHEN appointment_sequence_number = 1 THEN 'agendado'
        WHEN appointment_sequence_number = 2 AND is_jjrt IS TRUE THEN 'convertido'
        WHEN appointment_sequence_number = 2 AND is_jjrt IS FALSE THEN 'pendiente_revision'
        WHEN appointment_sequence_number >= 3 THEN 'recurrente'
        ELSE NULL
    END as auto_status
FROM public.v_doctoralia_appointment_sequence;

-- 3. Create or replace final status classification view (combining with leads CRM fallback)
-- This view provides a unified status for each lead, prioritizing Doctoralia data.
CREATE OR REPLACE VIEW public.v_lead_status_classification AS
WITH lead_auto_matches AS (
    SELECT 
        l.id as lead_id,
        l.phone_normalized as lead_phone,
        public.normalize_name(l.name) as lead_name_norm,
        l.crm_stage,
        las.auto_status,
        las.appointment_sequence_number,
        -- Take the latest valid status for the identity
        ROW_NUMBER() OVER (
            PARTITION BY l.id 
            ORDER BY 
                CASE 
                    WHEN las.auto_status = 'recurrente' THEN 4
                    WHEN las.auto_status = 'convertido' THEN 3
                    WHEN las.auto_status = 'agendado' THEN 2
                    WHEN las.auto_status = 'pendiente_revision' THEN 1
                    ELSE 0
                END DESC,
                las.appointment_date DESC, 
                las.id DESC
        ) as match_rank
    FROM public.leads l
    LEFT JOIN public.v_lead_auto_status_from_doctoralia las 
        ON (las.phone_normalized IS NOT NULL AND las.phone_normalized = l.phone_normalized)
        OR (las.identity_key = public.normalize_name(l.name))
    WHERE l.deleted_at IS NULL
)
SELECT 
    lead_id,
    lead_phone,
    crm_stage,
    auto_status,
    -- Precedence logic: recurrente > convertido > agendado > new_lead
    CASE 
        WHEN auto_status = 'recurrente' THEN 'recurrente'
        WHEN auto_status = 'convertido' THEN 'convertido'
        WHEN auto_status = 'agendado' THEN 'agendado'
        WHEN auto_status = 'pendiente_revision' THEN 'pendiente_revision'
        WHEN auto_status = 'cancelado' THEN 'cancelado'
        ELSE COALESCE(crm_stage, 'new_lead')
    END as final_status
FROM lead_auto_matches
WHERE match_rank = 1;

-- 4. Update core reporting views to use the new sequential logic
-- We need to drop dependent Figma views first.
DROP VIEW IF EXISTS public.v_figma_campaign_kpis CASCADE;
DROP VIEW IF EXISTS public.vw_campaign_performance_real CASCADE;
DROP VIEW IF EXISTS public.v_figma_executive_summary CASCADE;
DROP VIEW IF EXISTS public.v_figma_channel_performance CASCADE;
DROP VIEW IF EXISTS public.v_figma_monthly_trend CASCADE;
DROP VIEW IF EXISTS public.v_figma_lead_source_distribution CASCADE;
DROP VIEW IF EXISTS public.v_figma_conversion_funnel CASCADE;
DROP VIEW IF EXISTS public.v_figma_meta_performance CASCADE;
DROP VIEW IF EXISTS public.v_figma_google_ads_performance CASCADE;

-- Recreate vw_campaign_performance_real with the new logic
CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
SELECT
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::TEXT AS campaign_name,
  COALESCE(ma.campaign_id, l.campaign_id)::TEXT AS campaign_id,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::TEXT, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
  )::TEXT AS source,
  COUNT(*)::BIGINT AS total_leads,
  
  -- ALIGNED BOOKED LOGIC: 1st valid appointment or CRM appointment
  COUNT(*) FILTER (
    WHERE sc.final_status IN ('agendado', 'convertido', 'recurrente', 'pendiente_revision')
       OR l.appointment_date IS NOT NULL
       OR l.appointment_status IS NOT NULL
  )::BIGINT AS booked,
  
  -- CONVERTED LOGIC: 2nd valid appointment JJRT
  COUNT(*) FILTER (
    WHERE sc.final_status IN ('convertido', 'recurrente')
  )::BIGINT AS conversions,
  
  -- RECURRENT LOGIC: 3rd+ valid appointment
  COUNT(*) FILTER (
    WHERE sc.final_status = 'recurrente'
  )::BIGINT AS recurrent,
  
  -- CLOSED WON (Verified Revenue > 0)
  COUNT(*) FILTER (
    WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue, 0) > 0
  )::BIGINT AS closed_won,
  
  ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_estimated, l.revenue, 0)), 0), 2)::NUMERIC AS estimated_revenue,
  ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_verified, l.verified_revenue, 0)), 0), 2)::NUMERIC AS verified_revenue_crm,
  
  MIN(COALESCE(ut.lead_created_at, l.created_at)) AS first_lead_at,
  MAX(COALESCE(ut.lead_created_at, l.created_at)) AS last_lead_at
  
FROM public.leads l
LEFT JOIN public.v_lead_status_classification sc ON sc.lead_id = l.id
LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut ON ut.lead_id = l.id
LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
WHERE l.deleted_at IS NULL
GROUP BY
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::TEXT,
  COALESCE(ma.campaign_id, l.campaign_id)::TEXT,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::TEXT, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
  )::TEXT;

-- Recreate Figma Views with the new logic
CREATE OR REPLACE VIEW public.v_figma_campaign_kpis AS
SELECT
  campaign_name,
  MIN(campaign_id::TEXT) AS campaign_id,
  SUM(total_leads) AS total_leads,
  SUM(booked) AS booked,
  SUM(conversions) AS conversions,
  SUM(recurrent) AS recurrent,
  SUM(closed_won) AS closed_won,
  COALESCE(SUM(verified_revenue_crm), 0::NUMERIC) AS verified_revenue,
  ROUND(CASE WHEN SUM(total_leads) > 0 THEN SUM(booked)::NUMERIC / SUM(total_leads)::NUMERIC * 100::NUMERIC ELSE 0::NUMERIC END, 2) AS booking_rate_pct,
  ROUND(CASE WHEN SUM(total_leads) > 0 THEN SUM(conversions)::NUMERIC / SUM(total_leads)::NUMERIC * 100::NUMERIC ELSE 0::NUMERIC END, 2) AS conversion_rate_pct
FROM public.vw_campaign_performance_real
WHERE campaign_name IS NOT NULL
GROUP BY campaign_name
ORDER BY SUM(total_leads) DESC;

CREATE OR REPLACE VIEW v_figma_executive_summary AS
SELECT 
  'Leads (30d)' as metric,
  COUNT(*)::TEXT as value,
  'leads' as type
FROM leads
WHERE created_at >= NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'Conversions (30d)' as metric,
  COUNT(*)::TEXT as value,
  'conversions' as type
FROM leads l
JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE sc.final_status IN ('convertido', 'recurrente')
  AND l.created_at >= NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'Revenue (30d)' as metric,
  COALESCE(SUM(amount_net)::TEXT, '0') as value,
  'revenue' as type
FROM financial_settlements
WHERE settled_at >= NOW() - INTERVAL '30 days' AND cancelled_at IS NULL
UNION ALL
SELECT 
  'Active Channels' as metric,
  COUNT(DISTINCT utm_source)::TEXT as value,
  'channels' as type
FROM leads
WHERE created_at >= NOW() - INTERVAL '30 days';

CREATE OR REPLACE VIEW v_figma_channel_performance AS
SELECT 
  COALESCE(utm_source, 'direct') as channel,
  COUNT(*) as total_leads,
  COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente')) as conversions,
  ROUND(COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente'))::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
  COUNT(*) FILTER (WHERE sc.final_status IN ('agendado', 'convertido', 'recurrente', 'pendiente_revision')) as booked,
  DATE_TRUNC('day', MAX(l.created_at))::DATE as last_activity
FROM leads l
LEFT JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE l.created_at >= NOW() - INTERVAL '90 days'
GROUP BY COALESCE(utm_source, 'direct')
ORDER BY total_leads DESC;

CREATE OR REPLACE VIEW v_figma_monthly_trend AS
SELECT 
  DATE_TRUNC('month', l.created_at)::DATE as month,
  COUNT(*) as leads,
  COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente')) as conversions,
  ROUND(COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente'))::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
  COALESCE(SUM(l.verified_revenue), 0) as revenue,
  COUNT(DISTINCT l.utm_source) as active_channels
FROM leads l
LEFT JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE l.created_at >= NOW() - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', l.created_at)
ORDER BY month DESC;

CREATE OR REPLACE VIEW v_figma_lead_source_distribution AS
SELECT 
  COALESCE(utm_source, 'direct') as source,
  COUNT(*) as total_leads,
  ROUND(COUNT(*)::NUMERIC / NULLIF((SELECT COUNT(*) FROM leads), 0) * 100, 2) as percentage,
  COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente')) as conversions,
  ROUND(AVG(CASE WHEN sc.final_status IN ('convertido', 'recurrente') THEN 1 ELSE 0 END)::NUMERIC * 100, 2) as conversion_rate
FROM leads l
LEFT JOIN v_lead_status_classification sc ON sc.lead_id = l.id
GROUP BY COALESCE(utm_source, 'direct')
ORDER BY total_leads DESC;

CREATE OR REPLACE VIEW v_figma_conversion_funnel AS
SELECT 
  'Total Leads' as stage,
  COUNT(*) as count,
  100.0 as percentage
FROM leads
UNION ALL
SELECT 
  'Booked/Agendado' as stage,
  COUNT(*) as count,
  ROUND(COUNT(*)::NUMERIC / NULLIF((SELECT COUNT(*) FROM leads), 0) * 100, 2) as percentage
FROM leads l
JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE sc.final_status IN ('agendado', 'convertido', 'recurrente', 'pendiente_revision')
UNION ALL
SELECT 
  'Converted/Convertido' as stage,
  COUNT(*) as count,
  ROUND(COUNT(*)::NUMERIC / NULLIF((SELECT COUNT(*) FROM leads), 0) * 100, 2) as percentage
FROM leads l
JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE sc.final_status IN ('convertido', 'recurrente')
UNION ALL
SELECT 
  'Paid Patients' as stage,
  (SELECT COUNT(DISTINCT phone_normalized) FROM financial_settlements WHERE amount_net > 0 AND cancelled_at IS NULL) as count,
  ROUND((SELECT COUNT(DISTINCT phone_normalized) FROM financial_settlements WHERE amount_net > 0 AND cancelled_at IS NULL)::NUMERIC / NULLIF((SELECT COUNT(*) FROM leads), 0) * 100, 2) as percentage;

CREATE OR REPLACE VIEW v_figma_meta_performance AS
SELECT 
  DATE_TRUNC('day', l.created_at)::DATE as date,
  COUNT(*) as leads,
  COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente')) as conversions,
  MAX(l.created_at) as last_update
FROM leads l
LEFT JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE l.utm_source ILIKE '%facebook%' OR l.utm_source ILIKE '%instagram%'
GROUP BY DATE_TRUNC('day', l.created_at)
ORDER BY date DESC;

CREATE OR REPLACE VIEW v_figma_google_ads_performance AS
SELECT 
  DATE_TRUNC('day', l.created_at)::DATE as date,
  COUNT(*) as leads,
  COUNT(*) FILTER (WHERE sc.final_status IN ('convertido', 'recurrente')) as conversions,
  MAX(l.created_at) as last_update
FROM leads l
LEFT JOIN v_lead_status_classification sc ON sc.lead_id = l.id
WHERE l.utm_source ILIKE '%google%' OR l.utm_medium ILIKE '%cpc%'
GROUP BY DATE_TRUNC('day', l.created_at)
ORDER BY date DESC;

-- Security and Grants
ALTER VIEW public.v_doctoralia_appointment_sequence SET (security_invoker = true);
ALTER VIEW public.v_lead_auto_status_from_doctoralia SET (security_invoker = true);
ALTER VIEW public.v_lead_status_classification SET (security_invoker = true);
ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true);
ALTER VIEW public.v_figma_campaign_kpis SET (security_invoker = true);
ALTER VIEW public.v_figma_executive_summary SET (security_invoker = true);
ALTER VIEW public.v_figma_channel_performance SET (security_invoker = true);
ALTER VIEW public.v_figma_monthly_trend SET (security_invoker = true);
ALTER VIEW public.v_figma_lead_source_distribution SET (security_invoker = true);
ALTER VIEW public.v_figma_conversion_funnel SET (security_invoker = true);
ALTER VIEW public.v_figma_meta_performance SET (security_invoker = true);
ALTER VIEW public.v_figma_google_ads_performance SET (security_invoker = true);

GRANT SELECT ON public.v_doctoralia_appointment_sequence TO authenticated, service_role;
GRANT SELECT ON public.v_lead_auto_status_from_doctoralia TO authenticated, service_role;
GRANT SELECT ON public.v_lead_status_classification TO authenticated, service_role;
GRANT SELECT ON public.vw_campaign_performance_real TO authenticated, service_role;
GRANT SELECT ON public.v_figma_campaign_kpis TO authenticated, service_role;
GRANT SELECT ON public.v_figma_executive_summary TO authenticated, service_role;
GRANT SELECT ON public.v_figma_channel_performance TO authenticated, service_role;
GRANT SELECT ON public.v_figma_monthly_trend TO authenticated, service_role;
GRANT SELECT ON public.v_figma_lead_source_distribution TO authenticated, service_role;
GRANT SELECT ON public.v_figma_conversion_funnel TO authenticated, service_role;
GRANT SELECT ON public.v_figma_meta_performance TO authenticated, service_role;
GRANT SELECT ON public.v_figma_google_ads_performance TO authenticated, service_role;

COMMIT;
