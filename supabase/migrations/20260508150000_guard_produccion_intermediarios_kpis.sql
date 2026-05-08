-- =============================================================================
-- Guard Produccion Intermediarios KPI views
--
-- Recreates the Doctoralia Produccion Intermediarios KPI views only when the
-- raw Doctoralia table and required columns exist. This keeps drifted/preview
-- environments from failing with SQLSTATE 42P01 while preserving the intended
-- views in environments where Doctoralia ingestion is present.
-- =============================================================================

DO $$
DECLARE
  missing_columns TEXT[];
BEGIN
  IF to_regclass('public.doctoralia_raw') IS NULL THEN
    RAISE NOTICE 'Skipping vw_produccion_intermediarios_* views: public.doctoralia_raw does not exist';
    RETURN;
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
  FROM (
    VALUES
      ('clinic_id'),
      ('estado'),
      ('importe'),
      ('fecha'),
      ('fecha_creacion'),
      ('agenda'),
      ('treatment')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'doctoralia_raw'
      AND c.column_name = required.column_name
  );

  IF COALESCE(array_length(missing_columns, 1), 0) > 0 THEN
    RAISE NOTICE 'Skipping vw_produccion_intermediarios_* views: public.doctoralia_raw missing columns: %', missing_columns;
    RETURN;
  END IF;

  EXECUTE $view$
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
    GROUP BY clinic_id
  $view$;

  EXECUTE 'ALTER VIEW public.vw_produccion_intermediarios_kpis SET (security_invoker = true)';

  EXECUTE $comment$
    COMMENT ON VIEW public.vw_produccion_intermediarios_kpis IS
      'KPIs operativos y financieros sobre doctoralia_raw (Producción Intermediarios). Granularidad: por clinic_id.'
  $comment$;

  EXECUTE $view$
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
    GROUP BY clinic_id, agenda
  $view$;

  EXECUTE 'ALTER VIEW public.vw_produccion_intermediarios_by_agenda SET (security_invoker = true)';

  EXECUTE $comment$
    COMMENT ON VIEW public.vw_produccion_intermediarios_by_agenda IS
      'Productividad por Agenda (profesional / sala) sobre doctoralia_raw.'
  $comment$;

  EXECUTE $view$
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
    GROUP BY clinic_id, procedimiento
  $view$;

  EXECUTE 'ALTER VIEW public.vw_produccion_intermediarios_by_proc SET (security_invoker = true)';

  EXECUTE $comment$
    COMMENT ON VIEW public.vw_produccion_intermediarios_by_proc IS
      'Ingresos y ticket promedio por Procedimiento (extraído del Asunto) sobre doctoralia_raw.'
  $comment$;
END $$;
