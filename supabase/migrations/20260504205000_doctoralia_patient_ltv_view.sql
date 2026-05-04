-- 20260504205000_doctoralia_patient_ltv_view.sql
-- Vista de paciente consolidado que calcula ingresos totales, recurrencia y KPI de vida útil del paciente.

CREATE OR REPLACE VIEW public.vw_doctoralia_patient_ltv AS
SELECT
  paciente_telefono_normalized,
  paciente_telefono,
  paciente_id,
  paciente_nombre,
  procedimiento_nombre,
  COUNT(*) AS total_citas,
  COUNT(*) FILTER (WHERE cita_efectiva) AS citas_efectivas,
  COUNT(*) FILTER (WHERE cita_perdida) AS citas_perdidas,
  ROUND(COALESCE(SUM(importe_numerico) FILTER (WHERE cita_efectiva), 0), 2) AS ingresos_totales,
  ROUND(COALESCE(SUM(importe_numerico), 0), 2) AS ingresos_brutos,
  COUNT(DISTINCT campaign_name) AS campañas_distintas,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT campaign_name), NULL) AS campaign_names,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT ad_name), NULL) AS ad_names,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT form_name), NULL) AS form_names,
  MIN(timestamp_cita) AS primera_cita,
  MAX(timestamp_cita) AS ultima_cita,
  MIN(lead_created_at) AS primera_captacion,
  MAX(lead_created_at) AS ultima_captacion,
  AVG(lead_time_days) AS promedio_lead_time_dias
FROM public.vw_doctoralia_lead_traceability_unified
GROUP BY
  paciente_telefono_normalized,
  paciente_telefono,
  paciente_id,
  paciente_nombre,
  procedimiento_nombre;

ALTER VIEW public.vw_doctoralia_patient_ltv
  SET (security_invoker = true);

COMMENT ON VIEW public.vw_doctoralia_patient_ltv IS
  'Vista agregada de paciente que resume ingresos totales y recorrencia del paciente por telefono y origen de campaña.';
