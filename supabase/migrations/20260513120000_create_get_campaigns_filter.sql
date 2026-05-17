-- Migración: RPC para filtro de campañas (deduplicado + sin Doctoralia)
-- 1) Eliminar la función existente para permitir el cambio de signature (RETURNS TABLE)
DROP FUNCTION IF EXISTS public.get_campaigns_filter(date, date);

-- 2) Recrear la función contra public.leads. public.meta_daily_insights no
-- contiene campaign_id/campaign_name en producción; esas columnas viven en leads
-- hasta que una migración posterior cambia este RPC a produccion_intermediarios.
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
    l.campaign_id::TEXT AS campaign_id,
    COALESCE(NULLIF(TRIM(l.campaign_name::TEXT), ''), 'Sin nombre') AS campaign_name,
    COUNT(*)::BIGINT AS registros,
    COALESCE(SUM(l.revenue) FILTER (WHERE l.revenue IS NOT NULL), 0)::NUMERIC AS spend
  FROM public.leads l
  WHERE (p_since IS NULL OR l.created_at::DATE >= p_since)
    AND (p_until IS NULL OR l.created_at::DATE <= p_until)
    AND (l.source IS NULL OR LOWER(l.source::TEXT) <> 'doctoralia')
    AND l.deleted_at IS NULL
    AND l.campaign_id IS NOT NULL
  GROUP BY l.campaign_id, l.campaign_name
  ORDER BY campaign_name ASC;
$$;

-- Índice recomendado para rendimiento
CREATE INDEX IF NOT EXISTS idx_leads_campaign_filter
ON public.leads (campaign_id, created_at)
WHERE campaign_id IS NOT NULL AND deleted_at IS NULL;
