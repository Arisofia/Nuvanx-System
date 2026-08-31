
CREATE OR REPLACE VIEW public.master_pacientes_trazabilidad
WITH (security_invoker = true)
AS
WITH leads_clean AS (
  SELECT DISTINCT ON (leads.phone_normalized)
    leads.id,
    leads.name,
    leads.email_normalized,
    leads.phone_normalized,
    leads.source,
    leads.campaign_name,
    leads.ad_name,
    leads.form_name,
    leads.created_at,
    leads.clinic_id
  FROM leads
  WHERE leads.phone_normalized IS NOT NULL
    AND (leads.phone_normalized)::text <> ''
    AND leads.deleted_at IS NULL
  ORDER BY leads.phone_normalized, leads.created_at DESC
)
SELECT
  l.id                                                  AS lead_id,
  l.name                                                AS lead_name_meta,
  l.source                                              AS lead_source,
  l.campaign_name                                       AS meta_campaign,
  l.form_name                                           AS meta_form,
  l.created_at                                          AS meta_lead_date,
  dai.doctoralia_id                                     AS doc_patient_id,
  dai.patient_name                                      AS patient_name_clinical,
  dai.phone_normalized,
  dai.appointment_date,
  dai.appointment_time,
  dai.estado                                            AS appointment_status,
  dai.treatment                                         AS treatment_name,
  CAST(dai.amount AS numeric(12, 2))                    AS actual_revenue,
  dai.agenda                                            AS doctor_agenda,
  dai.origin                                            AS clinical_source,
  (dai.appointment_date - (l.created_at)::date)         AS days_to_conversion
FROM leads_clean l
JOIN doctoralia_appointments_ingestion dai
  ON (l.phone_normalized)::text = (dai.phone_normalized)::text
ORDER BY dai.appointment_date DESC NULLS LAST, l.created_at DESC;

COMMENT ON VIEW public.master_pacientes_trazabilidad IS
'Fix 2026-08-31 v2: usa doctoralia_appointments_ingestion (2244 filas, 6 leads match) en lugar de produccion_intermediarios (1 fila funcional).';
