-- Migration: 20260610220000_create_doctoralia_lead_match_audit_views.sql
-- Description: Create audit matching layer between Doctoralia appointments and Leads.
-- Criterio: No modificar datos, solo crear vistas para auditoría de matching.

BEGIN;

-- 1. Create the identity candidates view
CREATE OR REPLACE VIEW public.v_doctoralia_lead_identity_candidates AS
WITH d AS (
  SELECT
    s.id as doctoralia_appointment_id,
    s.identity_key as doctoralia_identity_key,
    s.patient_name as doctoralia_patient_name,
    s.phone_normalized as doctoralia_phone_normalized,
    s.appointment_date as doctoralia_appointment_date,
    s.auto_status as doctoralia_auto_status,
    public.normalize_person_name(s.patient_name) as doctoralia_name_norm
  FROM public.v_doctoralia_appointment_sequence s
  WHERE s.is_cancelled IS NOT TRUE
    AND s.identity_key IS NOT NULL
),
l AS (
  SELECT
    id as lead_id,
    name as lead_name,
    phone_normalized as lead_phone_normalized,
    name_normalized as lead_name_norm,
    created_at as lead_created_at,
    campaign_id,
    campaign_name,
    stage as crm_stage_raw,
    appointment_date as crm_appointment_date,
    verified_revenue as crm_verified_revenue
  FROM public.leads
  WHERE deleted_at IS NULL
)
SELECT
  d.doctoralia_appointment_id,
  d.doctoralia_identity_key,
  d.doctoralia_patient_name,
  d.doctoralia_phone_normalized,
  d.doctoralia_appointment_date,
  d.doctoralia_auto_status,
  l.lead_id,
  l.lead_name,
  l.lead_phone_normalized,
  l.lead_created_at,
  l.campaign_id as lead_campaign_id,
  l.campaign_name as lead_campaign_name,
  CASE
    WHEN d.doctoralia_phone_normalized IS NOT NULL
      AND l.lead_phone_normalized IS NOT NULL
      AND d.doctoralia_phone_normalized = l.lead_phone_normalized
      THEN 'phone_exact'
    WHEN d.doctoralia_name_norm IS NOT NULL
      AND l.lead_name_norm IS NOT NULL
      AND d.doctoralia_name_norm = l.lead_name_norm
      AND l.lead_created_at::date <= d.doctoralia_appointment_date
      THEN 'name_and_date_window'
    WHEN d.doctoralia_name_norm IS NOT NULL
      AND l.lead_name_norm IS NOT NULL
      AND d.doctoralia_name_norm = l.lead_name_norm
      THEN 'name_exact_normalized'
    ELSE NULL
  END as match_type,
  CASE
    WHEN d.doctoralia_phone_normalized IS NOT NULL
      AND l.lead_phone_normalized IS NOT NULL
      AND d.doctoralia_phone_normalized = l.lead_phone_normalized
      THEN 1.00
    WHEN d.doctoralia_name_norm IS NOT NULL
      AND l.lead_name_norm IS NOT NULL
      AND d.doctoralia_name_norm = l.lead_name_norm
      AND l.lead_created_at::date <= d.doctoralia_appointment_date
      THEN 0.85
    WHEN d.doctoralia_name_norm IS NOT NULL
      AND l.lead_name_norm IS NOT NULL
      AND d.doctoralia_name_norm = l.lead_name_norm
      THEN 0.80
    ELSE 0
  END as match_confidence,
  CASE
    WHEN d.doctoralia_phone_normalized = l.lead_phone_normalized
      THEN 'Coincidencia exacta por teléfono normalizado.'
    WHEN d.doctoralia_name_norm = l.lead_name_norm
      AND l.lead_created_at::date <= d.doctoralia_appointment_date
      THEN 'Coincidencia por nombre normalizado con lead anterior a cita.'
    WHEN d.doctoralia_name_norm = l.lead_name_norm
      THEN 'Coincidencia por nombre normalizado.'
    ELSE 'Sin match.'
  END as match_reason
FROM d
JOIN l
  ON (
    d.doctoralia_phone_normalized = l.lead_phone_normalized
    OR d.doctoralia_name_norm = l.lead_name_norm
  );

-- 2. Create the best match view
CREATE OR REPLACE VIEW public.v_doctoralia_lead_best_match AS
WITH ranked_matches AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY doctoralia_appointment_id
            ORDER BY 
                match_confidence DESC, 
                ABS(EXTRACT(EPOCH FROM (doctoralia_appointment_date - lead_created_at))) ASC
        ) as match_rank
    FROM public.v_doctoralia_lead_identity_candidates
)
SELECT 
    doctoralia_appointment_id,
    doctoralia_identity_key,
    doctoralia_patient_name,
    doctoralia_phone_normalized,
    doctoralia_appointment_date,
    doctoralia_auto_status,
    lead_id,
    lead_name,
    lead_phone_normalized,
    lead_created_at,
    lead_campaign_id,
    lead_campaign_name,
    match_type,
    match_confidence,
    match_reason
FROM ranked_matches 
WHERE match_rank = 1;

-- 3. Create the consolidated lead status view
CREATE OR REPLACE VIEW public.v_lead_status_auto_consolidated AS
WITH lead_best_doctoralia AS (
    -- Since one lead could match multiple appointments, we need the "best" status for the lead
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
                    WHEN doctoralia_auto_status = 'agendado' THEN 2
                    ELSE 1
                END DESC,
                doctoralia_appointment_date DESC
        ) as lead_match_rank
    FROM public.v_doctoralia_lead_best_match
)
SELECT
    l.id as lead_id,
    l.name as lead_name,
    l.campaign_id,
    l.campaign_name,
    l.stage as crm_stage_raw,
    l.appointment_date as crm_appointment_date,
    l.verified_revenue as crm_verified_revenue,
    bm.doctoralia_auto_status,
    bm.match_type,
    bm.match_confidence,
    CASE
        WHEN bm.doctoralia_auto_status = 'recurrente' THEN 'recurrente'
        WHEN bm.doctoralia_auto_status = 'convertido' THEN 'convertido'
        WHEN bm.doctoralia_auto_status = 'agendado' THEN 'agendado'
        ELSE l.stage
    END as consolidated_lead_status,
    CASE
        WHEN bm.lead_id IS NOT NULL THEN 'doctoralia_match'
        ELSE 'crm_fallback'
    END as status_source,
    CASE
        WHEN bm.lead_id IS NOT NULL THEN 'Matched via ' || bm.match_type || ' with confidence ' || bm.match_confidence
        ELSE 'No reliable Doctoralia match found.'
    END as status_reason
FROM public.leads l
LEFT JOIN lead_best_doctoralia bm ON l.id = bm.lead_id AND bm.lead_match_rank = 1
WHERE l.deleted_at IS NULL;

-- 4. Set security and grants
ALTER VIEW public.v_doctoralia_lead_identity_candidates SET (security_invoker = true);
ALTER VIEW public.v_doctoralia_lead_best_match SET (security_invoker = true);
ALTER VIEW public.v_lead_status_auto_consolidated SET (security_invoker = true);

GRANT SELECT ON public.v_doctoralia_lead_identity_candidates TO authenticated, service_role;
GRANT SELECT ON public.v_doctoralia_lead_best_match TO authenticated, service_role;
GRANT SELECT ON public.v_lead_status_auto_consolidated TO authenticated, service_role;

COMMIT;
