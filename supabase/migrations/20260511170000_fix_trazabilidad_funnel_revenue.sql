-- =============================================================================
-- Improve real revenue attribution in get_trazabilidad_funnel.
--
-- The previous version only matched Doctoralia settlements by lead phone and could
-- undercount revenue when a lead was already linked to a CRM patient or to a
-- doctoralia_patients row. This version attributes each settlement exactly once
-- using deterministic match priority:
--   1) direct converted_patient_id -> financial_settlements.patient_id
--   2) explicit doctoralia_patients.lead_id with matching normalized phone
--   3) normalized settlement phone -> normalized lead phone
-- Within each priority, the most recent eligible lead before the settlement wins.
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
      NULLIF(l.phone_normalized, '') AS phone_normalized,
      l.converted_patient_id,
      COALESCE(l.clinic_id, u.clinic_id) AS clinic_id
    FROM public.leads l
    LEFT JOIN public.users u ON u.id = l.user_id
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND (l.source IS NULL OR lower(btrim(l.source)) <> 'doctoralia')
      AND (p_lead_from IS NULL OR l.created_at::DATE >= p_lead_from)
      AND (p_lead_to IS NULL OR l.created_at::DATE <= p_lead_to)
  ),
  appointments_ranked AS (
    SELECT
      lb.id AS lead_id,
      da.fecha AS fecha_cita,
      ROW_NUMBER() OVER (
        PARTITION BY lb.id
        ORDER BY da.fecha ASC, da.hora ASC NULLS LAST, da.fecha_creacion ASC NULLS LAST
      ) AS rn,
      da.procedencia,
      da.estado
    FROM lead_base lb
    JOIN public.doctoralia_appointments da
      ON da.clinic_id = lb.clinic_id
     AND da.phone_normalized = lb.phone_normalized
     AND da.fecha >= lb.created_at::DATE
    WHERE lb.clinic_id IS NOT NULL
      AND lb.phone_normalized IS NOT NULL
      AND da.fecha IS NOT NULL
      AND da.phone_normalized IS NOT NULL
  ),
  appointments_funnel AS (
    SELECT
      lead_id,
      MAX(CASE WHEN rn = 1 THEN fecha_cita END) AS cita_valoracion,
      MAX(CASE WHEN rn = 2 THEN fecha_cita END) AS cita_posterior,
      MAX(procedencia) FILTER (WHERE rn IN (1, 2)) AS fuente,
      MAX(estado) FILTER (WHERE rn IN (1, 2)) AS estado
    FROM appointments_ranked
    WHERE rn <= 2
    GROUP BY lead_id
  ),
  settlement_base AS (
    SELECT
      fs.id AS settlement_id,
      fs.clinic_id,
      fs.patient_id,
      COALESCE(
        NULLIF(fs.phone_normalized, ''),
        NULLIF(public.normalize_phone(fs.patient_phone), ''),
        NULLIF(public.normalize_phone((regexp_match(fs.template_name, '\[([0-9]{9,15})\]'))[1]), '')
      ) AS settlement_phone,
      COALESCE(NULLIF(fs.amount_net, 0), NULLIF(fs.amount_gross, 0), 0)::NUMERIC AS revenue,
      fs.settled_at
    FROM public.financial_settlements fs
    WHERE fs.cancelled_at IS NULL
      AND lower(COALESCE(fs.source_system, '')) = 'doctoralia'
      AND COALESCE(NULLIF(fs.amount_net, 0), NULLIF(fs.amount_gross, 0), 0) > 0
      AND fs.settled_at IS NOT NULL
  ),
  settlement_candidates AS (
    SELECT
      lb.id AS lead_id,
      sb.settlement_id,
      sb.revenue,
      sb.settled_at,
      lb.created_at AS lead_created_at,
      1 AS match_priority
    FROM lead_base lb
    JOIN settlement_base sb
      ON sb.clinic_id = lb.clinic_id
     AND sb.patient_id = lb.converted_patient_id
     AND lb.converted_patient_id IS NOT NULL
     AND sb.settled_at >= lb.created_at

    UNION ALL

    SELECT
      lb.id AS lead_id,
      sb.settlement_id,
      sb.revenue,
      sb.settled_at,
      lb.created_at AS lead_created_at,
      2 AS match_priority
    FROM lead_base lb
    JOIN public.doctoralia_patients dp
      ON dp.lead_id = lb.id
     AND dp.clinic_id = lb.clinic_id
    JOIN settlement_base sb
      ON sb.clinic_id = lb.clinic_id
     AND sb.settled_at >= lb.created_at
     AND sb.settlement_phone IS NOT NULL
     AND sb.settlement_phone = COALESCE(
           NULLIF(dp.phone_normalized, ''),
           NULLIF(public.normalize_phone(dp.phone_primary), ''),
           NULLIF(public.normalize_phone(dp.phone_secondary), '')
         )

    UNION ALL

    SELECT
      lb.id AS lead_id,
      sb.settlement_id,
      sb.revenue,
      sb.settled_at,
      lb.created_at AS lead_created_at,
      3 AS match_priority
    FROM lead_base lb
    JOIN settlement_base sb
      ON sb.clinic_id = lb.clinic_id
     AND sb.settlement_phone = lb.phone_normalized
     AND lb.phone_normalized IS NOT NULL
     AND sb.settled_at >= lb.created_at
  ),
  settlement_attribution AS (
    SELECT
      lead_id,
      settlement_id,
      revenue,
      settled_at,
      ROW_NUMBER() OVER (
        PARTITION BY settlement_id
        ORDER BY match_priority ASC, lead_created_at DESC, lead_id DESC
      ) AS attribution_rank
    FROM settlement_candidates
  ),
  settlement_rollup AS (
    SELECT
      lead_id,
      ROUND(SUM(revenue), 2) AS revenue,
      MIN(settled_at) AS conversion_date
    FROM settlement_attribution
    WHERE attribution_rank = 1
    GROUP BY lead_id
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
    ON af.lead_id = lb.id
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
  'Returns acquisition lead -> first Doctoralia appointment -> posterior appointment funnel scoped by user, with real Doctoralia revenue attributed once per settlement via patient link, explicit Doctoralia patient match, or normalized phone fallback.';
