
-- ---------------------------------------------------------------------------
-- Fix: vw_lead_traceability — resolución del conflicto de tipo
--
-- CREATE OR REPLACE VIEW no puede cambiar el tipo de una columna existente.
-- La vista en prod tiene reply_delay_minutes como integer y la migración
-- que falló intentaba reemplazarla sin DROP previo.
-- No hay vistas dependientes (verificado). Se restauran todos los grants.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_lead_traceability;

CREATE VIEW public.vw_lead_traceability
WITH (security_invoker = true) AS
WITH fs_latest AS (
  SELECT DISTINCT ON (fs.lead_id)
    fs.lead_id,
    fs.id,
    fs.template_id,
    fs.template_name,
    fs.amount_net,
    fs.amount_gross,
    fs.settled_at,
    fs.intake_at,
    fs.source_system
  FROM public.financial_settlements fs
  ORDER BY fs.lead_id, fs.settled_at DESC NULLS LAST, fs.created_at DESC NULLS LAST
)
SELECT
  l.id AS lead_id,
  l.name AS lead_name,
  COALESCE(l.email, NULL::character varying)::text AS email_normalized,
  l.phone_normalized,
  l.source,
  l.stage::text AS stage,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  l.ad_id,
  l.ad_name,
  l.form_id,
  l.form_name,
  l.created_at AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue AS estimated_revenue,
  l.verified_revenue AS crm_verified_revenue,
  l.lost_reason::text AS lost_reason,
  p.id AS patient_id,
  p.total_ltv AS patient_ltv,
  fs.id::text AS settlement_id,
  fs.template_id AS doctoralia_template_id,
  fs.template_name AS doctoralia_template_name,
  fs.amount_net AS doctoralia_net,
  fs.amount_gross AS doctoralia_gross,
  fs.settled_at AS settlement_date,
  fs.intake_at AS settlement_intake_date,
  fs.source_system::text AS settlement_source,
  l.user_id AS lead_user_id,
  p.name::text AS patient_name,
  p.dni::text AS patient_dni,
  p.phone AS patient_phone,
  p.last_visit AS patient_last_visit,
  NULL::text AS doc_patient_id,
  NULL::numeric AS match_confidence,
  NULL::character varying(32) AS match_class,
  NULL::timestamptz AS first_settlement_at
FROM public.leads l
LEFT JOIN public.patients p ON p.id = l.converted_patient_id
LEFT JOIN fs_latest fs ON fs.lead_id = l.id
WHERE l.deleted_at IS NULL
  AND l.merged_into_lead_id IS NULL;

-- Restaurar grants exactos (snapshot tomado antes del DROP)
GRANT ALL ON public.vw_lead_traceability TO anon;
GRANT ALL ON public.vw_lead_traceability TO authenticated;
GRANT ALL ON public.vw_lead_traceability TO postgres;
GRANT ALL ON public.vw_lead_traceability TO service_role;
