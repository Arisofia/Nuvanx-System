-- =============================================================================
-- Fix Supabase advisor findings:
--   anon_security_definer_function_executable
--   authenticated_security_definer_function_executable
-- on public.get_campaign_roi(uuid, text, text, text).
--
-- Changes:
--   1. Recreate the function as SECURITY INVOKER so it runs under the caller's
--      privileges and respects RLS on underlying tables.
--   2. Revoke EXECUTE from PUBLIC, anon, and authenticated — the function is
--      only ever called by the Edge Function (service_role) via RPC; it must
--      not be directly callable from the Supabase REST API.
--   3. Re-grant EXECUTE to service_role only.
-- =============================================================================

-- Step 1: drop old SECURITY DEFINER overload
DROP FUNCTION IF EXISTS public.get_campaign_roi(uuid, text, text, text);

-- Step 2: recreate as SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_campaign_roi(
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
SECURITY INVOKER
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
    CASE WHEN g.source ILIKE '%meta%' OR g.source ILIKE '%facebook%' OR g.source ILIKE '%instagram%'
         THEN ms.total_spend
         ELSE NULL
    END AS spend,
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

-- Step 3: restrict access — service_role only; no public/anon/authenticated
REVOKE ALL ON FUNCTION public.get_campaign_roi(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_campaign_roi(uuid, text, text, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_campaign_roi(uuid, text, text, text) TO service_role;
