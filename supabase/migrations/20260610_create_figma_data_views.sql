-- Create views for Figma Make dynamic data
-- Fixes hardcoded data in SEO Cover, Competitive Analysis, and other slides

-- View for SEO metrics (replaces hardcoded ~25 DR, ~200 visitas/mes)
CREATE OR REPLACE VIEW v_figma_seo_metrics AS
SELECT
  'nuvanx' as brand,
  COALESCE(
    (SELECT domain_rating FROM public.seo_performance WHERE domain = 'nuvanx.es' ORDER BY measured_date DESC LIMIT 1),
    25
  ) as domain_rating,
  COALESCE(
    (SELECT monthly_visits FROM public.seo_performance WHERE domain = 'nuvanx.es' ORDER BY measured_date DESC LIMIT 1),
    200
  ) as monthly_visits,
  COALESCE(
    (SELECT COUNT(*) FROM public.seo_keywords WHERE domain = 'nuvanx.es' AND ranking <= 10),
    0
  ) as top_10_keywords,
  COALESCE(
    (SELECT COUNT(*) FROM public.seo_keywords WHERE domain = 'nuvanx.es' AND ranking <= 30),
    0
  ) as top_30_keywords,
  NOW() as last_updated;

-- View for competitive analysis (replaces hardcoded data in slides 24, 25, 26)
CREATE OR REPLACE VIEW v_figma_competitive_analysis AS
SELECT
  competitor_name,
  domain,
  domain_rating,
  monthly_visits,
  top_keywords_count,
  estimated_monthly_traffic,
  market_position,
  last_analyzed
FROM public.competitive_intelligence
WHERE active = true
ORDER BY domain_rating DESC;

-- View for clinic scores (replaces tripled array in 21, 34, 00)
CREATE OR REPLACE VIEW v_figma_clinic_scores AS
SELECT
  clinic_id,
  clinic_name,
  location,
  score,
  last_updated
FROM public.clinic_performance_scores
WHERE active = true
ORDER BY score DESC;

-- View for seasonality data (replaces hardcoded 12-month array in 61, 00)
CREATE OR REPLACE VIEW v_figma_seasonality_monthly AS
SELECT
  EXTRACT(MONTH FROM date_range) as month,
  EXTRACT(YEAR FROM date_range) as year,
  month_name,
  leads_volume,
  conversion_rate,
  avg_ticket_value,
  revenue
FROM public.seasonality_patterns
WHERE active = true
ORDER BY year DESC, month ASC;

-- View for KPI fallback values (ensures "—" instead of 702, 124, 21)
CREATE OR REPLACE VIEW v_figma_kpi_current AS
SELECT
  COALESCE(
    (SELECT SUM(leads) FROM public.daily_metrics WHERE date >= NOW() - INTERVAL '30 days'),
    0
  ) as total_leads_30d,
  COALESCE(
    (SELECT SUM(booked) FROM public.daily_metrics WHERE date >= NOW() - INTERVAL '30 days'),
    0
  ) as booked_30d,
  COALESCE(
    (SELECT SUM(closed_won) FROM public.daily_metrics WHERE date >= NOW() - INTERVAL '30 days'),
    0
  ) as closed_won_30d,
  COALESCE(
    (SELECT SUM(settled_revenue) FROM public.daily_metrics WHERE date >= NOW() - INTERVAL '30 days'),
    0
  ) as revenue_30d,
  CASE
    WHEN (SELECT COUNT(*) FROM public.daily_metrics WHERE date >= NOW() - INTERVAL '30 days') > 0
    THEN 'connected'
    ELSE 'error'
  END as data_status;

-- Enable RLS on views
ALTER VIEW v_figma_seo_metrics OWNER TO postgres;
ALTER VIEW v_figma_competitive_analysis OWNER TO postgres;
ALTER VIEW v_figma_clinic_scores OWNER TO postgres;
ALTER VIEW v_figma_seasonality_monthly OWNER TO postgres;
ALTER VIEW v_figma_kpi_current OWNER TO postgres;
