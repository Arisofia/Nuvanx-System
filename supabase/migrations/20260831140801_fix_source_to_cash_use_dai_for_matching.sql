
-- source_to_cash: reemplazar join patients/doctoralia_patients (0 overlap) por
-- doctoralia_appointments_ingestion (6 leads matchean por phone).
-- patients (6 filas) se mantiene como primera prioridad si hay match exacto.

DROP VIEW IF EXISTS public.source_to_cash CASCADE;

CREATE VIEW public.source_to_cash
WITH (security_invoker = true)
AS
WITH dai_ranked AS (
  -- Un lead puede tener N appointments; tomar el más reciente con mayor importe
  SELECT DISTINCT ON (dai.phone_normalized)
    dai.phone_normalized,
    dai.patient_name     AS dai_patient_name,
    dai.funnel_stage     AS dai_funnel_stage,
    dai.estado           AS dai_estado,
    dai.amount           AS dai_amount,
    dai.appointment_date AS dai_appointment_date
  FROM doctoralia_appointments_ingestion dai
  WHERE dai.phone_normalized IS NOT NULL
  ORDER BY dai.phone_normalized, dai.appointment_date DESC NULLS LAST
)
SELECT
  l.id                                                          AS lead_id,
  l.user_id,
  l.name                                                        AS lead_name,
  l.source                                                      AS acquisition_channel,
  COALESCE(l.stage_canonical, l.stage)                          AS current_stage,
  l.campaign_name,
  l.campaign_id,
  l.created_at                                                  AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.attended_at,
  l.no_show_flag,
  l.revenue                                                     AS crm_revenue,
  l.verified_revenue,
  COALESCE(p.id::text, dai.phone_normalized)                    AS patient_id,
  COALESCE(p.name, dai.dai_patient_name)                        AS patient_name,
  p.total_ltv                                                   AS doctoralia_ltv,
  fs.amount_net                                                 AS settled_amount,
  fs.template_name                                              AS financing_template,
  fs.settled_at,
  CASE
    WHEN p.id IS NOT NULL OR dai.phone_normalized IS NOT NULL THEN true
    ELSE false
  END                                                           AS matched_to_doctoralia,
  COALESCE(fs.amount_net, l.verified_revenue, l.revenue, 0::numeric) AS effective_revenue
FROM leads l
LEFT JOIN patients p
  ON  (p.dni_hash)::text    = (l.dni_hash)::text
  OR  (p.phone_normalized IS NOT NULL
       AND (p.phone_normalized)::text = (l.phone_normalized)::text)
  OR  (p.email_normalized IS NOT NULL
       AND (p.email_normalized)::text = (l.email_normalized)::text)
LEFT JOIN dai_ranked dai
  ON  p.id IS NULL
  AND (dai.phone_normalized)::text = (l.phone_normalized)::text
LEFT JOIN financial_settlements fs
  ON fs.patient_id = p.id
WHERE l.deleted_at IS NULL;

COMMENT ON VIEW public.source_to_cash IS
'Fix 2026-08-31: deleted_at filter + stage_canonical + match via doctoralia_appointments_ingestion (overlapping phones).';
