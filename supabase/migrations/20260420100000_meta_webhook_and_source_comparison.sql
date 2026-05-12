-- =============================================================================
-- Meta Lead Gen Webhook Support + Source Comparison Views
-- Fixes:
--   1. Add missing delivery/read/reply timestamp columns to whatsapp_conversations
--      (referenced by GET /api/conversations but not present in schema)
--   2. Create v_whatsapp_funnel view (referenced by GET /api/traceability/funnel)
--   3. Create v_campaign_roi view (referenced by GET /api/traceability/campaigns)
-- New:
--   4. Create vw_source_comparison view — WhatsApp vs Meta Lead Gen form KPIs
-- Guard:
--   5. Re-declare normalize_phone() idempotently so that patients_normalize_before_upsert
--      (created in 20260418170000) never fails on databases where 20260418180000 did
--      not precede a patient INSERT/UPDATE (e.g. restored snapshots, re-runs).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Idempotent re-declaration of normalize_phone (ordering guard)
--    Original definition lives in 20260418180000; this CREATE OR REPLACE is a
--    no-op when that migration has already run, and a safety net when it hasn't.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_phone(raw_phone TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_phone IS NULL OR raw_phone = '' THEN RETURN NULL; END IF;
  cleaned := regexp_replace(raw_phone, '[^0-9]', '', 'g');
  IF    length(cleaned) = 11 AND left(cleaned, 2)  = '34'   THEN cleaned := right(cleaned, 9);
  ELSIF length(cleaned) = 13 AND left(cleaned, 4)  = '0034' THEN cleaned := right(cleaned, 9);
  END IF;
  IF length(cleaned) < 7 THEN RETURN NULL; END IF;
  RETURN cleaned;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix whatsapp_conversations: add engagement timestamp columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at    TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. v_whatsapp_funnel — per-source funnel aggregation
--    (used by GET /api/traceability/funnel)
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_whatsapp_funnel CASCADE;

CREATE OR REPLACE VIEW public.v_whatsapp_funnel AS
SELECT
  source,
  COUNT(*)                                                                        AS total_leads,
  COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)                           AS contacted,
  COUNT(*) FILTER (WHERE first_inbound_at  IS NOT NULL)                           AS replied,
  COUNT(*) FILTER (WHERE appointment_status IN ('scheduled','confirmed','showed')) AS booked,
  COUNT(*) FILTER (WHERE appointment_status = 'showed')                           AS attended,
  COUNT(*) FILTER (WHERE no_show_flag = TRUE)                                     AS no_shows,
  COUNT(*) FILTER (WHERE verified_revenue > 0)                                    AS converted,
  ROUND(AVG(reply_delay_minutes) FILTER (WHERE reply_delay_minutes IS NOT NULL), 1) AS avg_reply_min,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL) /
    NULLIF(COUNT(*), 0), 1
  ) AS reply_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE appointment_status IN ('scheduled','confirmed','showed')) /
    NULLIF(COUNT(*), 0), 1
  ) AS booking_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE verified_revenue > 0) /
    NULLIF(COUNT(*), 0), 1
  ) AS close_rate_pct
FROM public.leads
GROUP BY source;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. v_campaign_roi — campaign × source ROI
--    (used by GET /api/traceability/campaigns)
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_campaign_roi CASCADE;

CREATE OR REPLACE VIEW public.v_campaign_roi AS
SELECT
  COALESCE(campaign_name, 'Organic / Unknown')                                    AS campaign_name,
  campaign_id,
  source,
  COUNT(*)                                                                        AS total_leads,
  COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)                           AS contacted,
  COUNT(*) FILTER (WHERE first_inbound_at  IS NOT NULL)                           AS replied,
  COUNT(*) FILTER (WHERE appointment_status IN ('scheduled','confirmed','showed')) AS booked,
  COUNT(*) FILTER (WHERE appointment_status = 'showed')                           AS attended,
  COUNT(*) FILTER (WHERE verified_revenue > 0)                                    AS closed_won,
  ROUND(COALESCE(SUM(verified_revenue), 0), 2)                                   AS verified_revenue,
  ROUND(COALESCE(SUM(revenue),          0), 2)                                   AS estimated_revenue,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL) /
    NULLIF(COUNT(*), 0), 1
  ) AS reply_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE verified_revenue > 0) /
    NULLIF(COUNT(*), 0), 1
  ) AS close_rate_pct,
  MIN(created_at) AS first_lead_at,
  MAX(created_at) AS last_lead_at
FROM public.leads
GROUP BY campaign_name, campaign_id, source;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. vw_source_comparison — WhatsApp click-to-chat vs Meta Lead Gen forms
--    (used by GET /api/reports/source-comparison)
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.vw_source_comparison CASCADE;

CREATE OR REPLACE VIEW public.vw_source_comparison AS
SELECT
  source,
  CASE
    WHEN source = 'whatsapp'                                              THEN 'WhatsApp Click-to-Chat'
    WHEN source IN ('meta_leadgen', 'meta_lead_gen', 'facebook_leadgen') THEN 'Meta Lead Gen Form'
    WHEN source = 'manual'                                                THEN 'Manual Entry'
    ELSE source
  END                                                                              AS source_label,
  COUNT(*)                                                                         AS total_leads,
  COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)                            AS contacted,
  COUNT(*) FILTER (WHERE first_inbound_at  IS NOT NULL)                            AS replied,
  COUNT(*) FILTER (WHERE appointment_status IN ('scheduled','confirmed','showed'))  AS booked,
  COUNT(*) FILTER (WHERE appointment_status = 'showed')                            AS attended,
  COUNT(*) FILTER (WHERE no_show_flag = TRUE)                                      AS no_shows,
  COUNT(*) FILTER (WHERE stage = 'closed' OR verified_revenue > 0)                AS closed_won,
  ROUND(COALESCE(SUM(revenue),           0), 2)                                   AS estimated_revenue,
  ROUND(COALESCE(SUM(verified_revenue),  0), 2)                                   AS verified_revenue,
  ROUND(AVG(reply_delay_minutes) FILTER (WHERE reply_delay_minutes IS NOT NULL), 1) AS avg_reply_delay_min,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL) /
    NULLIF(COUNT(*), 0), 1
  ) AS reply_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE appointment_status IN ('scheduled','confirmed','showed')) /
    NULLIF(COUNT(*), 0), 1
  ) AS booking_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE stage = 'closed' OR verified_revenue > 0) /
    NULLIF(COUNT(*), 0), 1
  ) AS close_rate_pct,
  MIN(created_at) AS first_lead_at,
  MAX(created_at) AS last_lead_at
FROM public.leads
GROUP BY source;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Permissions — service_role SELECT on all new views
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT ON public.v_whatsapp_funnel    TO service_role;
GRANT SELECT ON public.v_campaign_roi       TO service_role;
GRANT SELECT ON public.vw_source_comparison TO service_role;
