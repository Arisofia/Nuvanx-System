-- Migration: Reemplazar filtro de campañas con datos de producción de Doctoralia
-- Fuente de verdad: public.produccion_intermediarios
-- Sustituye el RPC orientado a Meta por uno orientado a Doctoralia.

DROP FUNCTION IF EXISTS public.get_campaigns_filter(DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_campaigns_filter(
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  campaign_id TEXT,
  total_citas BIGINT,
  total_importe NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT 
    campaign_id,
    COUNT(*) AS total_citas,
    SUM(importe)::NUMERIC AS total_importe
  FROM public.produccion_intermediarios
  WHERE campaign_id IS NOT NULL
    AND fecha >= p_from_date
    AND fecha <= p_to_date
  GROUP BY campaign_id
  ORDER BY campaign_id ASC;
$$;

-- Restringir ejecución solo al service_role
REVOKE ALL ON FUNCTION public.get_campaigns_filter(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_campaigns_filter(DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaigns_filter(DATE, DATE) TO service_role;
