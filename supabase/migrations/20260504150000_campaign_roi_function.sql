-- =============================================================================
-- Campaign ROI report function
-- Returns per (campaign_name, source, month) aggregated metrics joining:
--   - vw_lead_traceability  → leads, patients, Doctoralia net revenue
--   - meta_daily_insights   → Meta spend aggregated by month (account-level)
--
-- NOTE: Meta spend is account-level in meta_daily_insights (no campaign_id).
-- Per-campaign spend is pulled from vw_campaign_performance_real (estimated_revenue
-- from the leads table, not Meta API). The `spend` column is NULL for non-Meta
-- sources or when no Meta data is present.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_campaign_roi(
  p_user_id UUID,
  p_from     TEXT DEFAULT '',
  p_to       TEXT DEFAULT '',
  p_source   TEXT DEFAULT ''
)
RETURNS TABLE (
  campaign_name  TEXT,
  source         TEXT,
  month          TEXT,
  leads_count    BIGINT,
  patients_count BIGINT,
  net_revenue    NUMERIC,
  spend          NUMERIC,
  cac            NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH trace AS (
    SELECT
      COALESCE(t.campaign_name, 'Organic / Unknown') AS campaign_name,
      t.source,
      TO_CHAR(DATE_TRUNC('month', t.lead_created_at), 'YYYY-MM') AS month,
      t.lead_id,
      t.patient_id,
      t.doctoralia_net
    FROM vw_lead_traceability t
    WHERE t.lead_user_id = p_user_id
      AND (p_from = '' OR t.lead_created_at >= p_from::timestamptz)
      AND (p_to   = '' OR t.lead_created_at <= (p_to || 'T23:59:59Z')::timestamptz)
      AND (p_source = '' OR t.source = p_source)
  ),
  grouped AS (
    SELECT
      tr.campaign_name,
      tr.source,
      tr.month,
      COUNT(DISTINCT tr.lead_id)                                  AS leads_count,
      COUNT(DISTINCT tr.patient_id) FILTER (WHERE tr.patient_id IS NOT NULL) AS patients_count,
      ROUND(COALESCE(SUM(tr.doctoralia_net), 0), 2)               AS net_revenue
    FROM trace tr
    GROUP BY tr.campaign_name, tr.source, tr.month
  ),
  -- Account-level Meta spend aggregated by month for this user
  meta_spend AS (
    SELECT
      TO_CHAR(DATE_TRUNC('month', m.date::date), 'YYYY-MM') AS month,
      ROUND(SUM(m.spend), 2) AS total_spend
    FROM meta_daily_insights m
    WHERE m.user_id = p_user_id
      AND (p_from = '' OR m.date >= p_from::date)
      AND (p_to   = '' OR m.date <= p_to::date)
    GROUP BY 1
  )
  SELECT
    g.campaign_name,
    g.source,
    g.month,
    g.leads_count,
    g.patients_count,
    g.net_revenue,
    -- Attach account-level Meta spend only for Meta-sourced rows; NULL otherwise
    CASE WHEN g.source ILIKE '%meta%' OR g.source ILIKE '%facebook%' OR g.source ILIKE '%instagram%'
         THEN ms.total_spend
         ELSE NULL
    END AS spend,
    -- CAC = spend / patients_count (only when both are meaningful)
    CASE
      WHEN g.patients_count > 0
        AND (g.source ILIKE '%meta%' OR g.source ILIKE '%facebook%' OR g.source ILIKE '%instagram%')
        AND ms.total_spend IS NOT NULL AND ms.total_spend > 0
      THEN ROUND(ms.total_spend / g.patients_count, 2)
      ELSE NULL
    END AS cac
  FROM grouped g
  LEFT JOIN meta_spend ms ON ms.month = g.month
  ORDER BY g.month DESC, g.leads_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_campaign_roi(UUID, TEXT, TEXT, TEXT) TO service_role;
