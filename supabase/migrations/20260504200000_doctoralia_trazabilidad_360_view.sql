-- 20260504200000_doctoralia_trazabilidad_360_view.sql
-- Vista para exponer los campos normalizados de Doctoralia y habilitar KPIs de trazabilidad 360.

DO $$
DECLARE
  has_raw_hash BOOLEAN;
  has_source_file_id BOOLEAN;
  has_sheet_name BOOLEAN;
  has_hora BOOLEAN;
  has_hora_creacion BOOLEAN;
  has_asunto BOOLEAN;
  has_sala_box BOOLEAN;
  has_confirmada BOOLEAN;
  has_procedencia BOOLEAN;
  has_patient_name_norm BOOLEAN;
  has_phone_primary BOOLEAN;
  has_phone_secondary BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'raw_hash'
  ) INTO has_raw_hash;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'source_file_id'
  ) INTO has_source_file_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'sheet_name'
  ) INTO has_sheet_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'hora'
  ) INTO has_hora;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'hora_creacion'
  ) INTO has_hora_creacion;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'asunto'
  ) INTO has_asunto;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'sala_box'
  ) INTO has_sala_box;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'confirmada'
  ) INTO has_confirmada;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'procedencia'
  ) INTO has_procedencia;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'patient_name_norm'
  ) INTO has_patient_name_norm;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'phone_primary'
  ) INTO has_phone_primary;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctoralia_raw' AND column_name = 'phone_secondary'
  ) INTO has_phone_secondary;

  EXECUTE format($sql$
    CREATE OR REPLACE VIEW public.vw_doctoralia_trazabilidad_360 AS
    SELECT
      clinic_id,
      %s AS raw_hash,
      upload_id,
      %s AS source_file_id,
      %s AS sheet_name,
      estado,
      lower(btrim(coalesce(estado, ''))) AS estado_norm,
      fecha,
      %s AS hora,
      fecha_creacion,
      %s AS hora_creacion,
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
      %s AS asunto,
      agenda,
      %s AS sala_box,
      %s AS confirmada,
      %s AS procedencia,
      importe_numerico,
      importe_clean,
      is_ingreso,
      cita_efectiva,
      cita_perdida,
      paciente_id,
      paciente_nombre,
      paciente_telefono,
      procedimiento_nombre,
      %s AS patient_name_norm,
      %s AS phone_primary,
      %s AS phone_secondary,
      treatment
    FROM public.doctoralia_raw;
  $sql$,
    CASE WHEN has_raw_hash THEN 'raw_hash' ELSE 'NULL::text' END,
    CASE WHEN has_source_file_id THEN 'source_file_id' ELSE 'NULL::text' END,
    CASE WHEN has_sheet_name THEN 'sheet_name' ELSE 'NULL::text' END,
    CASE WHEN has_hora THEN 'hora' ELSE 'NULL::text' END,
    CASE WHEN has_hora_creacion THEN 'hora_creacion' ELSE 'NULL::time' END,
    CASE WHEN has_asunto THEN 'asunto' ELSE 'NULL::text' END,
    CASE WHEN has_sala_box THEN 'sala_box' ELSE 'NULL::text' END,
    CASE WHEN has_confirmada THEN 'confirmada' ELSE 'NULL::boolean' END,
    CASE WHEN has_procedencia THEN 'procedencia' ELSE 'NULL::text' END,
    CASE WHEN has_patient_name_norm THEN 'patient_name_norm' ELSE 'NULL::text' END,
    CASE WHEN has_phone_primary THEN 'phone_primary' ELSE 'NULL::text' END,
    CASE WHEN has_phone_secondary THEN 'phone_secondary' ELSE 'NULL::text' END
  );
END $$;

ALTER VIEW public.vw_doctoralia_trazabilidad_360
  SET (security_invoker = true);

COMMENT ON VIEW public.vw_doctoralia_trazabilidad_360 IS
  'Vista de trazabilidad 360 para Doctoralia. Exponer campos normalizados para análisis de paciente, tiempo y revenue.';
