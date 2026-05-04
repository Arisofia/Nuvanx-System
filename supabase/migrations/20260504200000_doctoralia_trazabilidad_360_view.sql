-- 20260504200000_doctoralia_trazabilidad_360_view.sql
-- Vista para exponer los campos normalizados de Doctoralia y habilitar KPIs de trazabilidad 360.

CREATE OR REPLACE VIEW public.vw_doctoralia_trazabilidad_360 AS
SELECT
  clinic_id,
  raw_hash,
  upload_id,
  source_file_id,
  sheet_name,
  estado,
  lower(btrim(coalesce(estado, ''))) AS estado_norm,
  fecha,
  hora,
  fecha_creacion,
  hora_creacion,
  timestamp_cita,
  timestamp_creacion,
  lead_time_days,
  lead_time_hours,
  fecha_mes,
  fecha_ano,
  trimestre,
  dia_semana,
  hora_inicio,
  franja_horaria,
  asunto,
  agenda,
  sala_box,
  confirmada,
  procedencia,
  importe_numerico,
  importe_clean,
  is_ingreso,
  cita_efectiva,
  cita_perdida,
  paciente_id,
  paciente_nombre,
  paciente_telefono,
  procedimiento_nombre,
  patient_name_norm,
  phone_primary,
  phone_secondary,
  treatment
FROM public.doctoralia_raw;

ALTER VIEW public.vw_doctoralia_trazabilidad_360
  SET (security_invoker = true);

COMMENT ON VIEW public.vw_doctoralia_trazabilidad_360 IS
  'Vista de trazabilidad 360 para Doctoralia. Exponer campos normalizados para análisis de paciente, tiempo y revenue.';
