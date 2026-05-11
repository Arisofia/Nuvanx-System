-- =============================================================================
-- Nuvanx Audit & Cleanup Migration
-- 1. Hardens doctoralia exclusion in get_trazabilidad_funnel
-- 2. Updates KPI views to strictly exclude acquisition leads from Doctoralia
-- 3. Case-insensitive source matching for consistency
-- =============================================================================

-- 1. Harden get_trazabilidad_funnel
-- FINAL VERSION with real revenue logic (Option 2)
CREATE OR REPLACE FUNCTION public.get_trazabilidad_funnel(
  p_user_id UUID DEFAULT auth.uid(),
  p_lead_from DATE DEFAULT NULL,
  p_lead_to DATE DEFAULT NULL,
  p_valoracion_from DATE DEFAULT NULL,
  p_valoracion_to DATE DEFAULT NULL,
  p_posterior_from DATE DEFAULT NULL,
  p_posterior_to DATE DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  lead_created_at TIMESTAMPTZ,
  lead_name TEXT,
  cita_valoracion DATE,
  cita_posterior DATE,
  fuente TEXT,
  estado TEXT,
  revenue NUMERIC,
  conversion_date TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lead_base AS (
    SELECT
      l.id,
      l.created_at,
      l.name,
      l.source,
      l.stage,
      l.phone_normalized,
      COALESCE(l.clinic_id, u.clinic_id) AS clinic_id
    FROM public.leads l
    LEFT JOIN public.users u ON u.id = l.user_id
    WHERE (l.user_id = p_user_id OR p_user_id IS NULL)
      AND l.deleted_at IS NULL
      AND (l.source IS NULL OR lower(btrim(l.source)) <> 'doctoralia')
      AND (p_lead_from IS NULL OR l.created_at::DATE >= p_lead_from)
      AND (p_lead_to IS NULL OR l.created_at::DATE <= p_lead_to)
  ),
  appointments_ranked AS (
    SELECT
      lb.id AS lead_id,
      da.fecha AS fecha_cita,
      ROW_NUMBER() OVER (
        PARTITION BY lb.id
        ORDER BY da.fecha ASC, da.hora ASC NULLS LAST, da.fecha_creacion ASC NULLS LAST
      ) AS rn,
      da.procedencia,
      da.estado
    FROM lead_base lb
    JOIN public.doctoralia_appointments da
      ON da.clinic_id = lb.clinic_id
     AND da.phone_normalized = lb.phone_normalized
     AND da.fecha >= lb.created_at::DATE
    WHERE lb.clinic_id IS NOT NULL
      AND da.fecha IS NOT NULL
      AND da.phone_normalized IS NOT NULL
  ),
  appointments_funnel AS (
    SELECT
      lead_id,
      MAX(CASE WHEN rn = 1 THEN fecha_cita END) AS cita_valoracion,
      MAX(CASE WHEN rn = 2 THEN fecha_cita END) AS cita_posterior,
      MAX(procedencia) FILTER (WHERE rn IN (1, 2)) AS fuente,
      MAX(estado) FILTER (WHERE rn IN (1, 2)) AS estado
    FROM appointments_ranked
    WHERE rn <= 2
    GROUP BY lead_id
  ),
  settlement_candidates AS (
    SELECT
      lb.id AS lead_id,
      fs.id AS settlement_id,
      fs.amount_net,
      fs.settled_at,
      ROW_NUMBER() OVER (
        PARTITION BY fs.id
        ORDER BY lb.created_at DESC, lb.id DESC
      ) AS attribution_rank
    FROM lead_base lb
    JOIN public.financial_settlements fs
      ON fs.clinic_id = lb.clinic_id
     AND fs.cancelled_at IS NULL
     AND fs.amount_net > 0
     AND fs.settled_at >= lb.created_at
     AND (
           lb.phone_normalized = fs.patient_phone
           OR 
           lb.phone_normalized = (regexp_match(fs.template_name, '\[([0-9]{9,15})\]'))[1]
         )
  ),
  settlement_rollup AS (
    SELECT
      lead_id,
      SUM(amount_net) AS revenue,
      MIN(settled_at) AS conversion_date
    FROM settlement_candidates
    WHERE attribution_rank = 1
    GROUP BY lead_id
  )
  SELECT
    lb.id,
    lb.created_at,
    lb.name,
    af.cita_valoracion,
    af.cita_posterior,
    COALESCE(af.fuente, lb.source) AS fuente,
    COALESCE(af.estado, lb.stage) AS estado,
    COALESCE(sr.revenue, 0)::NUMERIC AS revenue,
    sr.conversion_date
  FROM lead_base lb
  LEFT JOIN appointments_funnel af
    ON af.lead_id = lb.id
  LEFT JOIN settlement_rollup sr
    ON sr.lead_id = lb.id
  WHERE
    (p_valoracion_from IS NULL OR af.cita_valoracion >= p_valoracion_from)
    AND (p_valoracion_to IS NULL OR af.cita_valoracion <= p_valoracion_to)
    AND (p_posterior_from IS NULL OR af.cita_posterior >= p_posterior_from)
    AND (p_posterior_to IS NULL OR af.cita_posterior <= p_posterior_to)
  ORDER BY lb.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) TO service_role;

-- 2. Update vw_lead_traceability to exclude Doctoralia leads
DROP VIEW IF EXISTS public.vw_lead_traceability;
CREATE OR REPLACE VIEW public.vw_lead_traceability AS
SELECT
  l.id                    AS lead_id,
  l.name                  AS lead_name,
  l.email_normalized,
  l.phone_normalized,
  l.source,
  l.stage,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  l.ad_id,
  l.ad_name,
  l.form_id,
  l.form_name,
  l.created_at            AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue               AS estimated_revenue,
  l.verified_revenue      AS crm_verified_revenue,
  l.lost_reason,
  p.id                    AS patient_id,
  p.total_ltv             AS patient_ltv,
  fs.id                   AS settlement_id,
  fs.template_id          AS doctoralia_template_id,
  fs.template_name        AS doctoralia_template_name,
  fs.amount_net           AS doctoralia_net,
  fs.amount_gross         AS doctoralia_gross,
  fs.settled_at           AS settlement_date,
  fs.intake_at            AS settlement_intake_date,
  fs.source_system        AS settlement_source,
  l.user_id               AS lead_user_id,
  p.name                  AS patient_name,
  p.dni                   AS patient_dni,
  p.phone                 AS patient_phone,
  p.last_visit            AS patient_last_visit,
  dp.doc_patient_id,
  dp.match_confidence,
  dp.match_class,
  fs_first.settled_at     AS first_settlement_at
FROM public.leads l
LEFT JOIN public.users u ON u.id = l.user_id
LEFT JOIN public.patients p
  ON  (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
  OR   p.id = l.converted_patient_id
LEFT JOIN LATERAL (
  SELECT
    sub_dp.doc_patient_id,
    sub_dp.match_confidence,
    (CASE
      WHEN sub_dp.lead_id = l.id THEN sub_dp.match_class
      ELSE 'exact_phone'
    END)::VARCHAR(32) AS match_class
  FROM   public.doctoralia_patients sub_dp
  WHERE  (sub_dp.lead_id = l.id)
    OR   (
           u.clinic_id IS NOT NULL
           AND sub_dp.clinic_id = u.clinic_id
           AND sub_dp.phone_primary IS NOT NULL
           AND l.phone_normalized  IS NOT NULL
           AND RIGHT(regexp_replace(sub_dp.phone_primary,    '[^0-9]', '', 'g'), 9)
             = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
         )
  ORDER  BY sub_dp.match_confidence DESC NULLS LAST
  LIMIT  1
) dp ON TRUE
LEFT JOIN LATERAL (
  SELECT id, template_id, template_name, amount_net, amount_gross,
         settled_at, intake_at, source_system
  FROM   public.financial_settlements sub_fs
  WHERE  sub_fs.cancelled_at IS NULL
    AND  (
           (p.id IS NOT NULL AND sub_fs.patient_id = p.id)
           OR
           (
             u.clinic_id IS NOT NULL
             AND sub_fs.clinic_id = u.clinic_id
             AND l.phone_normalized IS NOT NULL
             AND l.phone_normalized <> ''
             AND RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               = RIGHT((regexp_match(sub_fs.template_name, '\[([0-9]{9,15})\]'))[1], 9)
           )
         )
  ORDER  BY sub_fs.settled_at DESC
  LIMIT  1
) fs ON TRUE
LEFT JOIN LATERAL (
  SELECT settled_at
  FROM   public.financial_settlements sub_fs2
  WHERE  sub_fs2.cancelled_at IS NULL
    AND  (
           (p.id IS NOT NULL AND sub_fs2.patient_id = p.id)
           OR
           (
             u.clinic_id IS NOT NULL
             AND sub_fs2.clinic_id = u.clinic_id
             AND l.phone_normalized IS NOT NULL
             AND l.phone_normalized <> ''
             AND RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               = RIGHT((regexp_match(sub_fs2.template_name, '\[([0-9]{9,15})\]'))[1], 9)
           )
         )
  ORDER  BY sub_fs2.settled_at ASC
  LIMIT  1
) fs_first ON TRUE
WHERE l.deleted_at IS NULL
  AND (l.source IS NULL OR lower(btrim(l.source)) <> 'doctoralia');

ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);

-- 3. Update vw_campaign_performance_real to exclude Doctoralia leads
DROP VIEW IF EXISTS public.vw_campaign_performance_real;
CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
SELECT
  l.user_id,
  u.clinic_id,
  COALESCE(l.campaign_name, 'Organic / Unknown') AS campaign_name,
  l.campaign_id,
  l.source,
  COUNT(*)                                        AS total_leads,
  COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL)                            AS contacted,
  COUNT(*) FILTER (WHERE l.first_inbound_at  IS NOT NULL)                            AS replied,
  COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled','confirmed','showed'))  AS booked,
  COUNT(*) FILTER (WHERE l.appointment_status = 'showed')                            AS attended,
  COUNT(*) FILTER (WHERE l.no_show_flag = TRUE)                                      AS no_shows,
  COUNT(*) FILTER (WHERE l.stage = 'closed')                                         AS closed,
  COUNT(*) FILTER (WHERE l.verified_revenue > 0)                                     AS closed_won,
  ROUND(COALESCE(SUM(l.revenue), 0), 2)           AS estimated_revenue,
  ROUND(COALESCE(SUM(l.verified_revenue), 0), 2)  AS verified_revenue_crm,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL) /
    NULLIF(COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL), 0), 1
  ) AS reply_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled','confirmed','showed')) /
    NULLIF(COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL), 0), 1
  ) AS replied_to_booked_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.stage = 'closed') / NULLIF(COUNT(*), 0), 1
  ) AS lead_to_close_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.no_show_flag = TRUE) /
    NULLIF(COUNT(*) FILTER (WHERE l.appointment_status IS NOT NULL), 0), 1
  ) AS no_show_rate_pct,
  ROUND(AVG(l.reply_delay_minutes), 1) AS avg_reply_delay_min,
  MIN(l.created_at)                    AS first_lead_at,
  MAX(l.created_at)                    AS last_lead_at
FROM leads l
LEFT JOIN users u ON u.id = l.user_id
WHERE l.deleted_at IS NULL
  AND (l.source IS NULL OR lower(btrim(l.source)) <> 'doctoralia')
GROUP BY l.user_id, u.clinic_id, l.campaign_name, l.campaign_id, l.source;

ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true);

-- 4. Update vw_whatsapp_conversion_real to exclude Doctoralia leads
DROP VIEW IF EXISTS public.vw_whatsapp_conversion_real;
CREATE OR REPLACE VIEW public.vw_whatsapp_conversion_real AS
SELECT
  user_id,
  clinic_id,
  CASE
    WHEN first_outbound_at IS NULL                           THEN 'not_contacted'
    WHEN first_inbound_at  IS NULL                           THEN 'contacted_no_reply'
    WHEN appointment_status IS NULL AND stage != 'closed'    THEN 'replied_not_booked'
    WHEN appointment_status IN ('scheduled','confirmed')     THEN 'booked_pending'
    WHEN appointment_status = 'showed' AND verified_revenue > 0 THEN 'attended_closed'
    WHEN appointment_status = 'showed'                       THEN 'attended_not_closed'
    WHEN no_show_flag = TRUE                                 THEN 'no_show'
    WHEN stage = 'closed'                                    THEN 'closed_no_appointment'
    ELSE                                                          'replied_other'
  END                                               AS cohort,
  COUNT(*)                                          AS lead_count,
  ROUND(COALESCE(SUM(revenue), 0), 2)              AS estimated_revenue,
  ROUND(COALESCE(SUM(verified_revenue), 0), 2)     AS verified_revenue_crm,
  ROUND(AVG(reply_delay_minutes), 1)               AS avg_reply_delay_min
FROM leads
WHERE deleted_at IS NULL
  AND (source IS NULL OR lower(btrim(source)) <> 'doctoralia')
GROUP BY 1, 2, 3;

ALTER VIEW public.vw_whatsapp_conversion_real SET (security_invoker = true);

-- 5. Update vw_doctor_performance_real to exclude Doctoralia leads
DROP VIEW IF EXISTS public.vw_doctor_performance_real;
CREATE OR REPLACE VIEW public.vw_doctor_performance_real AS
SELECT
  d.id                  AS doctor_id,
  d.name                AS doctor_name,
  d.specialty,
  d.is_active,
  COUNT(a.id)           AS total_appointments,
  COUNT(a.id) FILTER (WHERE a.status = 'showed')    AS attended_count,
  COUNT(a.id) FILTER (WHERE a.status = 'no_show')   AS no_show_count,
  COUNT(a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled_count,
  COUNT(a.id) FILTER (WHERE a.status = 'confirmed') AS confirmed_count,
  ROUND(
    100.0 * COUNT(a.id) FILTER (WHERE a.status = 'showed') / NULLIF(COUNT(a.id), 0), 1
  ) AS attended_rate_pct,
  ROUND(
    100.0 * COUNT(a.id) FILTER (WHERE a.status = 'no_show') / NULLIF(COUNT(a.id), 0), 1
  ) AS no_show_rate_pct,
  ROUND(COALESCE(SUM(l.revenue), 0), 2)          AS estimated_revenue,
  ROUND(COALESCE(SUM(l.verified_revenue), 0), 2) AS verified_revenue_crm
FROM doctors d
LEFT JOIN appointments a ON a.doctor_id = d.id
LEFT JOIN patients p ON p.id = a.patient_id
LEFT JOIN leads l ON l.converted_patient_id = p.id 
  AND l.deleted_at IS NULL 
  AND (l.source IS NULL OR lower(btrim(l.source)) <> 'doctoralia')
GROUP BY d.id, d.name, d.specialty, d.is_active;

ALTER VIEW public.vw_doctor_performance_real SET (security_invoker = true);
