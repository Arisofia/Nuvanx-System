-- =============================================================================
-- Real traceability funnel for acquisition leads -> Doctoralia appointments.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.doctoralia_appointments') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.doctoralia_appointments AS
      SELECT
        dr.id,
        dr.clinic_id,
        dr.estado,
        dr.fecha,
        dr.hora,
        COALESCE(dr.timestamp_creacion, dr.created_record_at, dr.fecha_creacion::TIMESTAMPTZ) AS fecha_creacion,
        dr.hora_creacion,
        dr.asunto,
        dr.agenda,
        dr.sala_box,
        dr.confirmada,
        dr.procedencia,
        COALESCE(dr.importe_numerico, dr.importe_clean, dr.importe, 0) AS importe,
        NULLIF(
          COALESCE(
            public.normalize_phone(dr.phone_primary),
            public.normalize_phone(dr.paciente_telefono),
            public.normalize_phone(dr.phone_secondary)
          ),
          ''
        ) AS phone_normalized,
        dr.paciente_telefono AS phone_raw,
        dr.paciente_nombre AS patient_name,
        COALESCE(dr.procedimiento_nombre, dr.treatment) AS treatment,
        dr.phone_primary,
        dr.phone_secondary,
        dr.created_at
      FROM public.doctoralia_raw dr
    $view$;

    EXECUTE 'ALTER VIEW public.doctoralia_appointments SET (security_invoker = true)';
    EXECUTE $comment$
      COMMENT ON VIEW public.doctoralia_appointments IS
        'Canonical projection of Produccion Intermediarios appointments. fecha is the appointment/clinic visit date; fecha_creacion is the appointment creation timestamp.'
    $comment$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_trazabilidad_funnel(
  p_user_id UUID DEFAULT auth.uid(),
  p_lead_from DATE DEFAULT NULL,
  p_lead_to DATE DEFAULT NULL,
  p_valoracion_from DATE DEFAULT NULL,
  p_valoracion_to DATE DEFAULT NULL,
  p_posterior_from DATE DEFAULT NULL,
  p_posterior_to DATE DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  lead_created_at TIMESTAMPTZ,
  cita_valoracion DATE,
  cita_posterior DATE,
  fuente TEXT,
  estado TEXT,
  revenue NUMERIC,
  conversion_date TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH lead_base AS (
    SELECT
      l.id,
      l.created_at,
      l.source,
      l.stage,
      l.phone_normalized,
      COALESCE(l.clinic_id, u.clinic_id) AS clinic_id
    FROM public.leads l
    LEFT JOIN public.users u ON u.id = l.user_id
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND (l.source IS NULL OR lower(l.source) <> 'doctoralia')
      AND l.phone_normalized IS NOT NULL
      AND (p_lead_from IS NULL OR l.created_at::DATE >= p_lead_from)
      AND (p_lead_to IS NULL OR l.created_at::DATE <= p_lead_to)
  ),
  appointments_ranked AS (
    SELECT
      da.clinic_id,
      da.phone_normalized AS phone_key,
      da.fecha AS fecha_cita,
      ROW_NUMBER() OVER (
        PARTITION BY da.clinic_id, da.phone_normalized
        ORDER BY da.fecha ASC, da.hora ASC NULLS LAST, da.fecha_creacion ASC NULLS LAST
      ) AS rn,
      da.procedencia,
      da.estado
    FROM public.doctoralia_appointments da
    WHERE da.fecha IS NOT NULL
      AND da.phone_normalized IS NOT NULL
  ),
  appointments_funnel AS (
    SELECT
      clinic_id,
      phone_key,
      MAX(CASE WHEN rn = 1 THEN fecha_cita END) AS cita_valoracion,
      MAX(CASE WHEN rn = 2 THEN fecha_cita END) AS cita_posterior,
      MAX(procedencia) FILTER (WHERE rn IN (1, 2)) AS fuente,
      MAX(estado) FILTER (WHERE rn IN (1, 2)) AS estado
    FROM appointments_ranked
    WHERE rn <= 2
    GROUP BY clinic_id, phone_key
  ),
  settlement_rollup AS (
    SELECT
      lb.id AS lead_id,
      SUM(fs.amount_net) AS revenue,
      MIN(fs.settled_at) AS conversion_date
    FROM lead_base lb
    JOIN public.financial_settlements fs
      ON fs.clinic_id = lb.clinic_id
     AND fs.cancelled_at IS NULL
     AND fs.amount_net > 0
     AND lower(COALESCE(fs.source_system, '')) = 'doctoralia'
     AND public.normalize_phone(fs.patient_phone) = lb.phone_normalized
    GROUP BY lb.id
  )
  SELECT
    lb.id AS lead_id,
    lb.created_at AS lead_created_at,
    af.cita_valoracion,
    af.cita_posterior,
    COALESCE(af.fuente, lb.source)::TEXT AS fuente,
    COALESCE(af.estado, lb.stage)::TEXT AS estado,
    COALESCE(sr.revenue, 0)::NUMERIC AS revenue,
    sr.conversion_date
  FROM lead_base lb
  LEFT JOIN appointments_funnel af
    ON af.clinic_id = lb.clinic_id
   AND af.phone_key = lb.phone_normalized
  LEFT JOIN settlement_rollup sr
    ON sr.lead_id = lb.id
  WHERE (p_valoracion_from IS NULL OR af.cita_valoracion >= p_valoracion_from)
    AND (p_valoracion_to IS NULL OR af.cita_valoracion <= p_valoracion_to)
    AND (p_posterior_from IS NULL OR af.cita_posterior >= p_posterior_from)
    AND (p_posterior_to IS NULL OR af.cita_posterior <= p_posterior_to)
  ORDER BY lb.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) TO service_role;

COMMENT ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) IS
  'Returns the real acquisition lead -> first Doctoralia appointment (doctoralia_appointments.fecha) -> posterior appointment funnel scoped by user, with verified Doctoralia revenue by phone.';
