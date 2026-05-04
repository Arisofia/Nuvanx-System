-- 20260504190000_doctoralia_raw_normalization.sql
-- Añade columnas necesarias para la normalización completa de Doctoralia.

ALTER TABLE public.doctoralia_raw
  ADD COLUMN IF NOT EXISTS timestamp_cita TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timestamp_creacion TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_time_days NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS lead_time_hours NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS fecha_mes TEXT,
  ADD COLUMN IF NOT EXISTS fecha_ano INTEGER,
  ADD COLUMN IF NOT EXISTS trimestre INTEGER,
  ADD COLUMN IF NOT EXISTS dia_semana TEXT,
  ADD COLUMN IF NOT EXISTS hora_inicio TEXT,
  ADD COLUMN IF NOT EXISTS franja_horaria TEXT,
  ADD COLUMN IF NOT EXISTS importe_numerico NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS importe_clean NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS is_ingreso BOOLEAN,
  ADD COLUMN IF NOT EXISTS cita_efectiva BOOLEAN,
  ADD COLUMN IF NOT EXISTS cita_perdida BOOLEAN,
  ADD COLUMN IF NOT EXISTS paciente_id VARCHAR(32),
  ADD COLUMN IF NOT EXISTS paciente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS paciente_telefono VARCHAR(32),
  ADD COLUMN IF NOT EXISTS procedimiento_nombre TEXT;

CREATE INDEX IF NOT EXISTS idx_doctoralia_raw_paciente_telefono
  ON public.doctoralia_raw (paciente_telefono);
