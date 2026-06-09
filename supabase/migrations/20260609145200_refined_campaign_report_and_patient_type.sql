-- Refined Campaign Report and Patient Type Classification
-- Date: 2026-06-09

BEGIN;

-- Ensure handle_updated_at function exists for triggers
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Persistir canal histórico en leads (Punto 4)
-- Se añade la columna `historical_channel` a `public.leads` si no existe.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS historical_channel text;

-- Función para asignar el canal histórico
CREATE OR REPLACE FUNCTION public.set_historical_channel_on_lead()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.historical_channel IS NULL THEN
    -- Si el lead proviene de Meta Lead Form (RRSS)
    IF NEW.meta_lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lead_events WHERE meta_lead_id = NEW.meta_lead_id AND source_channel = 'RRSS') THEN
      NEW.historical_channel := 'RRSS';
    -- Si no es de Meta Lead Form, se asume 'ORGANICO'
    ELSE
      NEW.historical_channel := 'ORGANICO';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para asignar el canal histórico en la inserción de leads
DROP TRIGGER IF EXISTS trg_set_historical_channel ON public.leads;
CREATE TRIGGER trg_set_historical_channel
BEFORE INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.set_historical_channel_on_lead();

-- 2. Vista de Funnel RRSS (Reglas Punto 5)
CREATE OR REPLACE VIEW public.vw_funnel_rrss AS
WITH rrss_leads AS (
    SELECT
        meta_lead_id,
        normalized_phone,
        normalized_email,
        campaign_id,
        campaign_name,
        event_created_at
    FROM public.lead_events
    WHERE source_channel = 'RRSS'
),
appointments AS (
    -- Asumimos que doctoralia_appointments_ingestion ya existe y contiene patient_phone, agenda, status, appointment_date
    SELECT patient_phone, agenda, status, appointment_date
    FROM public.doctoralia_appointments_ingestion
)
SELECT
    l.meta_lead_id,
    l.campaign_id,
    l.campaign_name,
    l.normalized_email,
    l.normalized_phone,
    l.event_created_at as fecha_lead,
    (EXISTS (SELECT 1 FROM appointments a WHERE a.patient_phone = l.normalized_phone)) as valoracion_agendada,
    (EXISTS (SELECT 1 FROM appointments a WHERE a.patient_phone = l.normalized_phone AND a.agenda ILIKE '%Javier%')) as procedimiento_agendado,
    ((SELECT COUNT(*) FROM appointments a WHERE a.patient_phone = l.normalized_phone AND a.agenda ILIKE '%Enfermería%') >= 3) as procedimiento_realizado
FROM rrss_leads l;

-- 3. Clasificación de Pacientes (Reglas Punto 6)
CREATE OR REPLACE VIEW public.vw_patient_classification AS
WITH patient_visits AS (
    SELECT
        patient_phone,
        appointment_date,
        agenda,
        LAG(appointment_date) OVER (PARTITION BY patient_phone ORDER BY appointment_date) as prev_visit_date,
        FIRST_VALUE(appointment_date) OVER (PARTITION BY patient_phone ORDER BY appointment_date) as first_visit_date
    FROM public.doctoralia_appointments_ingestion
),
patient_activity AS (
    SELECT
        patient_phone,
        MAX(appointment_date) as last_visit,
        MIN(appointment_date) as first_visit,
        COUNT(*) as total_visits,
        EXISTS (SELECT 1 FROM patient_visits pv2 WHERE pv2.patient_phone = pv.patient_phone AND (pv2.agenda ILIKE '%Javier%' OR pv2.agenda ILIKE '%Enfermería%')) as has_treatment
    FROM patient_visits pv
    GROUP BY patient_phone
)
SELECT
    patient_phone,
    CASE
        -- prospecto: solo valoración o lead sin tratamiento.
        WHEN NOT has_treatment THEN 'prospecto'
        -- perdido: día 61 sin nueva visita/tratamiento.
        WHEN (NOW() - last_visit) > interval '60 days' THEN 'perdido'
        -- nuevo: primera vez que realiza tratamiento (visita Javier o Enfermería).
        WHEN has_treatment AND total_visits = 1 THEN 'nuevo'
        -- recurrente: nueva visita/tratamiento en menos de 60 días desde la última visita.
        WHEN has_treatment AND (NOW() - last_visit) <= interval '60 days' THEN 'recurrente'
        -- recuperado: nueva visita/tratamiento después de más de 60 días desde la última visita.
        ELSE 'recuperado'
    END as patient_type
FROM patient_activity;

-- 4. Reconstruir tabla de campañas (Punto 8)
DROP FUNCTION IF EXISTS public.get_campaign_report(date, date);
CREATE OR REPLACE FUNCTION public.get_campaign_report(from_date date, to_date date)
RETURNS TABLE (
    campana text,
    leads bigint,
    valoraciones_agendadas bigint,
    procedimientos_agendados bigint,
    procedimientos_realizados bigint,
    cerrados bigint,
    close_rate numeric,
    revenue numeric,
    ultimo_lead timestamptz
) AS $$
BEGIN
    RETURN QUERY
    WITH campaign_stats AS (
        SELECT
            v.campaign_name as campaign,
            COUNT(DISTINCT v.meta_lead_id) as leads_count,
            COUNT(DISTINCT CASE WHEN v.valoracion_agendada THEN v.meta_lead_id END) as val_agendadas,
            COUNT(DISTINCT CASE WHEN v.procedimiento_agendado THEN v.meta_lead_id END) as proc_agendados,
            COUNT(DISTINCT CASE WHEN v.procedimiento_realizado THEN v.meta_lead_id END) as proc_realizados,
            -- cerrados: procedimientos_realizados o cobro confirmado
            COUNT(DISTINCT CASE WHEN v.procedimiento_realizado OR EXISTS (
                SELECT 1 FROM public.financial_settlements fs
                WHERE fs.phone_normalized = v.normalized_phone
                AND fs.amount_net > 0
                AND fs.settled_at::date BETWEEN from_date AND to_date
            ) THEN v.meta_lead_id END) as closed_count,
            COALESCE(SUM(fs.amount_net), 0) as total_revenue,
            MAX(v.fecha_lead) as last_lead
        FROM public.vw_funnel_rrss v
        LEFT JOIN public.financial_settlements fs ON fs.phone_normalized = v.normalized_phone
            AND fs.settled_at::date BETWEEN from_date AND to_date
        WHERE v.fecha_lead::date BETWEEN from_date AND to_date
        GROUP BY v.campaign_name
    )
    SELECT
        campaign,
        leads_count,
        val_agendadas,
        proc_agendados,
        proc_realizados,
        closed_count,
        CASE WHEN leads_count > 0 THEN ROUND((closed_count::numeric / leads_count::numeric) * 100, 2) ELSE 0 END as close_rate,
        total_revenue,
        last_lead
    FROM campaign_stats
    WHERE leads_count > 0 OR val_agendadas > 0 OR proc_agendados > 0 OR proc_realizados > 0 OR total_revenue > 0
    ORDER BY leads_count DESC, total_revenue DESC, last_lead DESC;
END;
$$ LANGUAGE plpgsql;

-- 5. Backfill de `lead_events` desde `meta_attribution` (Punto 11 - Backfill)
INSERT INTO public.lead_events (
    meta_lead_id,
    source_channel,
    channel_label,
    source_platform,
    event_type,
    attribution_locked,
    full_name,
    email,
    phone,
    normalized_email,
    normalized_phone,
    campaign_id,
    campaign_name,
    adset_id,
    adset_name,
    ad_id,
    ad_name,
    event_created_at,
    captured_at,
    resolution_status
)
SELECT
    COALESCE(l.external_id, 'historical_' || ma.lead_id::text), -- Usar external_id de leads si existe, sino un ID histórico
    'RRSS',
    'RRSS',
    'meta',
    'meta_lead_form',
    true,
    CASE WHEN l.name LIKE 'Meta Lead %' THEN NULL ELSE l.name END, -- No inventar nombres genéricos
    CASE WHEN l.email = '' THEN NULL ELSE l.email END,             -- No inventar emails vacíos
    CASE WHEN l.phone = '' THEN NULL ELSE l.phone END,             -- No inventar teléfonos vacíos
    CASE WHEN l.normalized_email = '' THEN NULL ELSE l.normalized_email END,
    CASE WHEN l.normalized_phone = '' THEN NULL ELSE l.normalized_phone END,
    ma.campaign_id,
    ma.campaign_name,
    ma.adset_id,
    ma.adset_name,
    ma.ad_id,
    ma.ad_name,
    COALESCE(l.created_at, ma.captured_at), -- Usar fecha de creación del lead si existe, sino la de captura
    ma.captured_at,
    'historical_unresolved'
FROM public.meta_attribution ma
JOIN public.leads l ON ma.lead_id = l.id
ON CONFLICT (meta_lead_id) DO NOTHING;

COMMIT;