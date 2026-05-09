-- =============================================================================
-- Real traceability funnel for acquisition leads -> Doctoralia appointments.
-- =============================================================================

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
      dr.clinic_id,
      COALESCE(
        public.normalize_phone(dr.phone_primary),
        public.normalize_phone(dr.paciente_telefono),
        public.normalize_phone(dr.phone_normalized)
      ) AS phone_key,
      dr.fecha AS fecha_cita,
      ROW_NUMBER() OVER (
        PARTITION BY dr.clinic_id,
          COALESCE(
            public.normalize_phone(dr.phone_primary),
            public.normalize_phone(dr.paciente_telefono),
            public.normalize_phone(dr.phone_normalized)
          )
        ORDER BY dr.fecha ASC, dr.hora ASC NULLS LAST, dr.created_at ASC NULLS LAST
      ) AS rn,
      dr.procedencia,
      dr.estado
    FROM public.doctoralia_raw dr
    WHERE dr.fecha IS NOT NULL
      AND COALESCE(
        public.normalize_phone(dr.phone_primary),
        public.normalize_phone(dr.paciente_telefono),
        public.normalize_phone(dr.phone_normalized)
      ) IS NOT NULL
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
  'Returns the real acquisition lead -> first Doctoralia appointment -> posterior appointment funnel scoped by user, with verified Doctoralia revenue by phone.';
