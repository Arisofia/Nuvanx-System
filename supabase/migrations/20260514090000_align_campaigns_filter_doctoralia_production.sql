-- =============================================================================
-- Align campaigns filter with Doctoralia production source of truth
--
-- The dashboard/API campaign filter must report real Doctoralia appointments and
-- realized production amounts from produccion_intermediarios, not Meta spend.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_campaigns_filter(DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_campaigns_filter(
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  campaign_id TEXT,
  total_citas INTEGER,
  total_importe NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pi.campaign_id,
    COUNT(*)::INTEGER AS total_citas,
    COALESCE(SUM(pi.importe), 0)::NUMERIC AS total_importe
  FROM public.produccion_intermediarios pi
  WHERE pi.fecha BETWEEN p_from_date AND p_to_date
    AND pi.campaign_id IS NOT NULL
  GROUP BY pi.campaign_id
  ORDER BY pi.campaign_id ASC;
END;
$$;

COMMENT ON FUNCTION public.get_campaigns_filter(DATE, DATE) IS
  'Aggregates Doctoralia production appointments and amount by campaign_id from public.produccion_intermediarios for the requested appointment date range.';

REVOKE ALL ON FUNCTION public.get_campaigns_filter(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaigns_filter(DATE, DATE) TO service_role;

COMMIT;
