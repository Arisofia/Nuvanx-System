-- Migración: RPC para filtro de campañas (deduplicado + sin Doctoralia)
CREATE OR REPLACE FUNCTION public.get_campaigns_filter(
  p_since DATE DEFAULT NULL,
  p_until DATE DEFAULT NULL
)
RETURNS TABLE (
  campaign_id TEXT,
  campaign_name TEXT,
  registros BIGINT,
  spend NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT 
    campaign_id,
    COALESCE(NULLIF(TRIM(campaign_name), ''), 'Sin nombre') AS campaign_name,
    COUNT(*) AS registros,
    SUM(spend) FILTER (WHERE spend IS NOT NULL)::NUMERIC AS spend
  FROM public.meta_daily_insights
  WHERE (p_since IS NULL OR date >= p_since)
    AND (p_until IS NULL OR date <= p_until)
    AND (source IS NULL OR LOWER(source) <> 'doctoralia')
    AND campaign_id IS NOT NULL
  GROUP BY campaign_id, campaign_name
  ORDER BY campaign_name ASC;
$$;

-- Índice recomendado para rendimiento
CREATE INDEX IF NOT EXISTS idx_meta_daily_insights_campaign 
ON public.meta_daily_insights (clinic_id, date, campaign_id);
