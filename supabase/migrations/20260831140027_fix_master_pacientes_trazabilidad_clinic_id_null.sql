
-- BUG: master_pacientes_trazabilidad = 0 rows porque produccion_intermediarios.clinic_id IS NULL
-- en la mayoría de filas. El JOIN l.clinic_id = pi.clinic_id descarta todos.
-- Fix: permitir NULL en pi.clinic_id, o sea, clinic_id match es opcional si pi no lo tiene.

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
  l.id                                          AS lead_id,
  l.name                                        AS lead_name_meta,
  l.source                                      AS lead_source,
  l.campaign_name                               AS meta_campaign,
  l.form_name                                   AS meta_form,
  l.created_at                                  AS meta_lead_date,
  pi.doc_patient_id,
  pi.paciente_nombre                            AS patient_name_clinical,
  pi.phone_normalized,
  pi.fecha                                      AS appointment_date,
  pi.hora                                       AS appointment_time,
  pi.estado                                     AS appointment_status,
  pi.procedimiento_nombre                       AS treatment_name,
  pi.importe                                    AS actual_revenue,
  pi.agenda                                     AS doctor_agenda,
  pi.procedencia                                AS clinical_source,
  (pi.fecha - (l.created_at)::date)             AS days_to_conversion
FROM leads_clean l
JOIN produccion_intermediarios pi
  ON (l.phone_normalized)::text = pi.phone_normalized
  -- clinic_id match sólo cuando pi tiene clinic_id poblado
  AND (pi.clinic_id IS NULL OR l.clinic_id = pi.clinic_id)
ORDER BY pi.fecha DESC, l.created_at DESC;

COMMENT ON VIEW public.master_pacientes_trazabilidad IS
'Fix 2026-08-31: clinic_id join es NULL-tolerante. produccion_intermediarios.clinic_id no siempre está poblado.';
