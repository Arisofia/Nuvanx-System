
-- Fix mínimo seguro: preservar columnas originales exactas, sólo agregar WHERE deleted_at IS NULL.
-- La expansión de columnas requiere DROP+recrear que rompe dependencias — se hace en migración separada.

DROP VIEW IF EXISTS public.source_to_cash CASCADE;

CREATE VIEW public.source_to_cash
WITH (security_invoker = true)
AS
SELECT
  l.id                                           AS lead_id,
  l.user_id,
  l.name                                         AS lead_name,
  l.source                                       AS acquisition_channel,
  COALESCE(l.stage_canonical, l.stage)           AS current_stage,
  l.campaign_name,
  l.campaign_id,
  l.created_at                                   AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.attended_at,
  l.no_show_flag,
  l.revenue                                      AS crm_revenue,
  l.verified_revenue,
  COALESCE(p.id::text, dp.doc_patient_id)        AS patient_id,
  COALESCE(p.name, dp.full_name)                 AS patient_name,
  p.total_ltv                                    AS doctoralia_ltv,
  fs.amount_net                                  AS settled_amount,
  fs.template_name                               AS financing_template,
  fs.settled_at,
  CASE
    WHEN p.id IS NOT NULL OR dp.doc_patient_id IS NOT NULL THEN true
    ELSE false
  END                                            AS matched_to_doctoralia,
  COALESCE(fs.amount_net, l.verified_revenue, l.revenue, 0::numeric) AS effective_revenue
FROM leads l
LEFT JOIN patients p
  ON  (p.dni_hash)::text = (l.dni_hash)::text
  OR  (p.phone_normalized IS NOT NULL
       AND (p.phone_normalized)::text = (l.phone_normalized)::text)
  OR  (p.email_normalized IS NOT NULL
       AND (p.email_normalized)::text = (l.email_normalized)::text)
LEFT JOIN doctoralia_patients dp
  ON  p.id IS NULL
  AND dp.phone_normalized IS NOT NULL
  AND (dp.phone_normalized)::text = (l.phone_normalized)::text
LEFT JOIN financial_settlements fs
  ON fs.patient_id = p.id
WHERE l.deleted_at IS NULL;

COMMENT ON VIEW public.source_to_cash IS
'Lead-to-cash. Fix 2026-08-31: deleted_at IS NULL + stage_canonical + fallback match doctoralia_patients.';
