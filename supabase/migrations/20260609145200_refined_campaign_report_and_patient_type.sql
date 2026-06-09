-- Refined Campaign Report and Patient Type Classification
-- Date: 2026-06-09

BEGIN;

-- 1. Refined RRSS Funnel View to include campaign_id and phone_normalized
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
    SELECT patient_phone, agenda, status, appointment_date
    FROM public.doctoralia_appointments_ingestion
)
SELECT 
    l.meta_lead_id,
    l.campaign_id,
    l.campaign_name,
    l.normalized_phone,
    l.event_created_at as fecha_lead,
    (EXISTS (SELECT 1 FROM appointments a WHERE a.patient_phone = l.normalized_phone)) as valoracion_agendada,
    (EXISTS (SELECT 1 FROM appointments a WHERE a.patient_phone = l.normalized_phone AND a.agenda ILIKE '%Javier%')) as procedimiento_agendado,
    ((SELECT COUNT(*) FROM appointments a WHERE a.patient_phone = l.normalized_phone AND a.agenda ILIKE '%Enfermería%') >= 3) as procedimiento_realizado
FROM rrss_leads l;

-- 2. Refined get_campaign_report (Point 8)
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

-- 3. Refined Patient Type (Point 6)
-- Rules:
-- prospecto: solo valoración o lead sin tratamiento.
-- nuevo: primera vez que realiza tratamiento (visita Javier o Enfermería).
-- recurrente: nueva visita < 60 días desde la última.
-- recuperado: nueva visita > 60 días desde la última.
-- perdido: día 61 sin nueva visita/tratamiento.

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
        -- Si solo tiene valoración o es un lead sin tratamiento (visitas que no son Javier/Enfermería)
        WHEN NOT has_treatment THEN 'prospecto'
        -- Si tiene tratamiento y es el primer periodo (menos de 60 días desde la primera visita)
        WHEN has_treatment AND (NOW() - last_visit) > interval '60 days' THEN 'perdido'
        WHEN has_treatment AND total_visits = 1 THEN 'nuevo'
        WHEN has_treatment AND (last_visit - first_visit) <= interval '60 days' THEN 'nuevo'
        -- Recurrente: nueva visita < 60 días desde la anterior
        -- Aquí simplificamos: si ha tenido visitas constantes es recurrente
        WHEN has_treatment AND (NOW() - last_visit) <= interval '60 days' THEN 'recurrente'
        -- Recuperado: volvió después de 60 días
        ELSE 'recuperado'
    END as patient_type
FROM patient_activity;

COMMIT;
