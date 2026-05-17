-- Migration: Reemplazar filtro de campañas con datos de producción de Doctoralia
-- Fuente de verdad: public.produccion_intermediarios
-- Sustituye el RPC orientado a Meta por uno orientado a Doctoralia.

BEGIN;

DROP FUNCTION IF EXISTS public.get_campaigns_filter(DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_campaigns_filter(
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
  campaign_id TEXT,
  total_citas INTEGER,
  total_importe NUMERIC,
  registros INTEGER,
  spend NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    pi.campaign_id,
    COUNT(*)::INTEGER AS total_citas,
    COALESCE(SUM(pi.importe), 0)::NUMERIC AS total_importe,
    COUNT(*)::INTEGER AS registros,
    COALESCE(SUM(pi.importe), 0)::NUMERIC AS spend
  FROM public.produccion_intermediarios pi
  WHERE (p_from_date IS NULL OR pi.fecha >= p_from_date)
    AND (p_to_date IS NULL OR pi.fecha <= p_to_date)
    AND NULLIF(BTRIM(pi.campaign_id), '') IS NOT NULL
  GROUP BY pi.campaign_id
  ORDER BY pi.campaign_id ASC;
$$;

COMMENT ON FUNCTION public.get_campaigns_filter(DATE, DATE) IS
  'Aggregates Doctoralia production appointments and amount by campaign_id from public.produccion_intermediarios. registros/spend are deprecated compatibility aliases for total_citas/total_importe.';

REVOKE ALL ON FUNCTION public.get_campaigns_filter(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaigns_filter(DATE, DATE) TO service_role;

COMMIT;
