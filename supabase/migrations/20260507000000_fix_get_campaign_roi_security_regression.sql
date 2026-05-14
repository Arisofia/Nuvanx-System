-- =============================================================================
-- Fix SECURITY DEFINER regression on get_campaign_roi.
--
-- Root cause:
--   Migration 20260504170000_fix_campaign_roi_security.sql correctly set the
--   function to SECURITY INVOKER and revoked EXECUTE from anon/authenticated.
--   Migration 20260505000000_refine_campaign_roi_patient_view.sql (which ran
--   afterward) re-created the function as SECURITY DEFINER and only did
--   GRANT EXECUTE TO service_role without the corresponding REVOKE. This means
--   any authenticated user can call the function directly via
--   /rest/v1/rpc/get_campaign_roi and read any user's campaign ROI data, since
--   SECURITY DEFINER executes under the superuser and bypasses RLS.
--
-- Fix:
--   1. Drop the SECURITY DEFINER overload.
--   2. Re-create the function as SECURITY INVOKER (same logic as 20260505000000
--      but with the correct security qualifier).
--   3. Revoke EXECUTE from PUBLIC, anon, and authenticated.
--   4. Grant EXECUTE to service_role only.
-- =============================================================================

-- Step 1: drop the SECURITY DEFINER overload
DROP FUNCTION IF EXISTS public.get_campaign_roi(uuid, text, text, text);

-- Step 2: re-create as SECURITY INVOKER so RLS on underlying tables is respected
CREATE FUNCTION public.get_campaign_roi(
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
      COALESCE(t.source, 'Unknown') AS source,
      DATE_TRUNC('month', t.lead_created_at) AS month_date,
      t.lead_id,
      COALESCE(t.patient_id, u.lead_converted_patient_id) AS patient_id,
      COALESCE(u.importe_numerico, t.doctoralia_net, 0) AS net_revenue
    FROM public.vw_lead_traceability t
    LEFT JOIN vw_doctoralia_lead_traceability_unified u
      ON u.lead_id = t.lead_id
    WHERE t.lead_user_id = p_user_id
      -- Garantía Nuvanx: Doctoralia es CRM/Pacientes, no fuente de leads de captación
      AND (t.source IS NULL OR LOWER(t.source) != 'doctoralia')
      AND (p_from = '' OR t.lead_created_at >= p_from::timestamptz)
      AND (p_to   = '' OR t.lead_created_at <= (p_to || 'T23:59:59Z')::timestamptz)
      AND (p_source = '' OR t.source = p_source)
  ),
  grouped AS (
    SELECT
      campaign_name,
      source,
      TO_CHAR(month_date, 'YYYY-MM') AS month,
      COUNT(DISTINCT lead_id) AS leads_count,
      COUNT(DISTINCT patient_id) FILTER (WHERE patient_id IS NOT NULL) AS patients_count,
      ROUND(SUM(net_revenue), 2) AS net_revenue
    FROM trace
    GROUP BY campaign_name, source, month
  ),
  meta_spend AS (
    SELECT
      TO_CHAR(DATE_TRUNC('month', m.date::date), 'YYYY-MM') AS month,
      ROUND(SUM(m.spend), 2) AS total_spend
    FROM public.meta_daily_insights m
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

-- Step 3: revoke from PUBLIC, anon, authenticated — service_role only
REVOKE ALL   ON FUNCTION public.get_campaign_roi(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_campaign_roi(uuid, text, text, text) FROM anon, authenticated;

-- Step 4: grant only to service_role (called exclusively by the Edge Function)
GRANT  EXECUTE ON FUNCTION public.get_campaign_roi(uuid, text, text, text) TO service_role;
