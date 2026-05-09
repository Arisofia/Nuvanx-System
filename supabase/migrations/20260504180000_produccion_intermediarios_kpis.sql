-- =============================================================================
-- 20260504180000_produccion_intermediarios_kpis.sql
--
-- KPIs sobre doctoralia_raw (sheet "Produccion Intermediarios").
-- Crea dos vistas:
--   1. vw_produccion_intermediarios_kpis        — KPIs globales por clinic_id
--   2. vw_produccion_intermediarios_by_agenda   — Productividad por Agenda
--   3. vw_produccion_intermediarios_by_proc     — Procedimiento más rentable
--
-- KPIs cubiertos:
--   - Ingresos Totales        : SUM(importe) WHERE estado IN ('realizada','pagada')
--   - Volumen de Citas        : COUNT(*)
--   - Tasa de Cancelación %   : citas anuladas / total * 100
--   - Ticket Promedio         : ingresos / citas efectivas
--   - Lead Time de Reserva    : AVG(fecha - fecha_creacion) en días
--   - Productividad por Agenda (vista separada)
--   - Procedimiento más rentable (vista separada)
--
-- Notas:
--   - Se usa lower(trim(estado)) para tolerar mayúsculas / espacios.
--   - "Efectivas" = realizada + pagada.
--   - security_invoker = true para respetar RLS de doctoralia_raw.
-- =============================================================================

-- 1. KPIs globales por clínica
CREATE OR REPLACE VIEW public.vw_produccion_intermediarios_kpis AS
WITH base AS (
  SELECT
    clinic_id,
    lower(btrim(COALESCE(estado, ''))) AS estado_norm,
    COALESCE(importe, 0)               AS importe,
    fecha,
    fecha_creacion
  FROM public.doctoralia_raw
)
SELECT
  clinic_id,
  COUNT(*)                                                                AS volumen_citas,
  COUNT(*) FILTER (WHERE estado_norm IN ('realizada','pagada'))           AS citas_efectivas,
  COUNT(*) FILTER (WHERE estado_norm = 'anulada')                         AS citas_anuladas,
  ROUND(
    COALESCE(SUM(importe) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0),
    2
  )                                                                        AS ingresos_totales,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE estado_norm = 'anulada')
    / NULLIF(COUNT(*), 0),
    2
  )                                                                        AS tasa_cancelacion_pct,
  ROUND(
    COALESCE(SUM(importe) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0)
    / NULLIF(COUNT(*) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0),
    2
  )                                                                        AS ticket_promedio,
  ROUND(
    AVG((fecha - fecha_creacion))
      FILTER (WHERE fecha IS NOT NULL AND fecha_creacion IS NOT NULL),
    1
  )                                                                        AS lead_time_reserva_dias
FROM base
GROUP BY clinic_id;

ALTER VIEW IF EXISTS public.vw_produccion_intermediarios_kpis
  SET (security_invoker = true);

COMMENT ON VIEW public.vw_produccion_intermediarios_kpis IS
  'KPIs operativos y financieros sobre doctoralia_raw (Producción Intermediarios). Granularidad: por clinic_id.';


-- 2. Productividad por Agenda
CREATE OR REPLACE VIEW public.vw_produccion_intermediarios_by_agenda AS
WITH base AS (
  SELECT
    clinic_id,
    COALESCE(NULLIF(btrim(agenda), ''), '(sin agenda)') AS agenda,
    lower(btrim(COALESCE(estado, '')))                  AS estado_norm,
    COALESCE(importe, 0)                                AS importe
  FROM public.doctoralia_raw
)
SELECT
  clinic_id,
  agenda,
  COUNT(*)                                                                AS volumen_citas,
  COUNT(*) FILTER (WHERE estado_norm IN ('realizada','pagada'))           AS citas_efectivas,
  COUNT(*) FILTER (WHERE estado_norm = 'anulada')                         AS citas_anuladas,
  ROUND(
    COALESCE(SUM(importe) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0),
    2
  )                                                                        AS ingresos_totales,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE estado_norm = 'anulada')
    / NULLIF(COUNT(*), 0),
    2
  )                                                                        AS tasa_cancelacion_pct,
  ROUND(
    COALESCE(SUM(importe) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0)
    / NULLIF(COUNT(*) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0),
    2
  )                                                                        AS ticket_promedio
FROM base
GROUP BY clinic_id, agenda;

ALTER VIEW IF EXISTS public.vw_produccion_intermediarios_by_agenda
  SET (security_invoker = true);

COMMENT ON VIEW public.vw_produccion_intermediarios_by_agenda IS
  'Productividad por Agenda (profesional / sala) sobre doctoralia_raw.';


-- 3. Procedimiento más rentable
CREATE OR REPLACE VIEW public.vw_produccion_intermediarios_by_proc AS
WITH base AS (
  SELECT
    clinic_id,
    COALESCE(NULLIF(btrim(treatment), ''), '(sin procedimiento)') AS procedimiento,
    lower(btrim(COALESCE(estado, '')))                            AS estado_norm,
    COALESCE(importe, 0)                                          AS importe
  FROM public.doctoralia_raw
)
SELECT
  clinic_id,
  procedimiento,
  COUNT(*)                                                                AS volumen_citas,
  COUNT(*) FILTER (WHERE estado_norm IN ('realizada','pagada'))           AS citas_efectivas,
  ROUND(
    COALESCE(SUM(importe) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0),
    2
  )                                                                        AS ingresos_totales,
  ROUND(
    COALESCE(SUM(importe) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0)
    / NULLIF(COUNT(*) FILTER (WHERE estado_norm IN ('realizada','pagada')), 0),
    2
  )                                                                        AS ticket_promedio
FROM base
GROUP BY clinic_id, procedimiento;

ALTER VIEW IF EXISTS public.vw_produccion_intermediarios_by_proc
  SET (security_invoker = true);

COMMENT ON VIEW public.vw_produccion_intermediarios_by_proc IS
  'Ingresos y ticket promedio por Procedimiento (extraído del Asunto) sobre doctoralia_raw.';
