-- =============================================================================
-- CAPI / Trazabilidad Enrichment (Priority 3)
-- - Add fbc, fbp, capi_sent columns
-- - Enrich vw_doctoralia_lead_traceability_unified with lead_fbc / lead_fbp
-- - Add capi_sent to produccion_intermediarios
-- =============================================================================

-- 1. Add columns to leads (if not present)
DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    ALTER TABLE public.leads
      ADD COLUMN IF NOT EXISTS fbc TEXT,
      ADD COLUMN IF NOT EXISTS fbp TEXT,
      ADD COLUMN IF NOT EXISTS capi_sent BOOLEAN DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_leads_fbc ON public.leads(fbc) WHERE fbc IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_leads_fbp ON public.leads(fbp) WHERE fbp IS NOT NULL;
  END IF;
END $$;

-- 2. Add capi_sent to produccion_intermediarios (for CAPI Purchase guard)
DO $$
BEGIN
  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    ALTER TABLE public.produccion_intermediarios
      ADD COLUMN IF NOT EXISTS capi_sent BOOLEAN DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_capi_sent
      ON public.produccion_intermediarios(capi_sent) WHERE capi_sent = FALSE;
  END IF;
END $$;

-- 3. Enrich vw_doctoralia_lead_traceability_unified with lead_fbc / lead_fbp
DO $$
BEGIN
  IF to_regclass('public.vw_doctoralia_lead_traceability_unified') IS NOT NULL THEN
    -- We recreate the view with the new columns
    -- Note: This assumes the previous definition. Adjust if the base view changes.
    EXECUTE 'DROP VIEW IF EXISTS public.vw_doctoralia_lead_traceability_unified CASCADE';

    EXECUTE '
    CREATE OR REPLACE VIEW public.vw_doctoralia_lead_traceability_unified AS
    SELECT
      dr.*,
      COALESCE(
        normalize_phone(dr.paciente_telefono),
        normalize_phone(dr.phone_primary),
        normalize_phone(dr.phone_secondary)
      ) AS paciente_telefono_normalized,

      l.id                    AS lead_id,
      l.external_id           AS leadgen_id,
      l.name                  AS lead_full_name,
      l.phone                 AS lead_phone,
      l.phone_normalized      AS lead_phone_normalized,
      l.source                AS lead_source,
      l.stage                 AS lead_stage,
      l.created_at            AS lead_created_at,
      l.campaign_name         AS campaign_name,
      l.ad_name               AS ad_name,
      l.form_name             AS form_name,
      l.fbc                   AS lead_fbc,
      l.fbp                   AS lead_fbp,
      NULL::text              AS campaign_id,
      NULL::text              AS adset_id,
      NULL::text              AS adset_name,
      NULL::text              AS ad_id,
      l.revenue               AS lead_revenue_estimated,
      l.verified_revenue      AS lead_revenue_verified,
      l.appointment_status,
      l.attended_at,
      l.no_show_flag,
      l.converted_patient_id  AS lead_converted_patient_id,
      l.priority              AS lead_priority
    FROM public.vw_doctoralia_trazabilidad_360 dr
    LEFT JOIN public.leads l
      ON (
        normalize_phone(dr.paciente_telefono) = l.phone_normalized
        OR normalize_phone(dr.phone_primary)  = l.phone_normalized
        OR normalize_phone(dr.phone_secondary) = l.phone_normalized
      )';

    -- Re-create dependent views dropped by CASCADE
    EXECUTE '
    CREATE OR REPLACE VIEW public.vw_doctoralia_patient_ltv AS
    SELECT
      paciente_telefono_normalized,
      paciente_telefono,
      paciente_id,
      paciente_nombre,
      procedimiento_nombre,
      COUNT(*) AS total_citas,
      COUNT(*) FILTER (WHERE cita_efectiva) AS citas_efectivas,
      COUNT(*) FILTER (WHERE cita_perdida) AS citas_perdidas,
      ROUND(COALESCE(SUM(importe_numerico) FILTER (WHERE cita_efectiva), 0), 2) AS ingresos_totales,
      ROUND(COALESCE(SUM(importe_numerico), 0), 2) AS ingresos_brutos,
      COUNT(DISTINCT campaign_name) AS campañas_distintas,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT campaign_name), NULL) AS campaign_names,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT ad_name), NULL) AS ad_names,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT form_name), NULL) AS form_names,
      MIN(timestamp_cita) AS primera_cita,
      MAX(timestamp_cita) AS ultima_cita,
      MIN(lead_created_at) AS primera_captacion,
      MAX(lead_created_at) AS ultima_captacion,
      AVG(lead_time_days) AS promedio_lead_time_dias
    FROM public.vw_doctoralia_lead_traceability_unified
    GROUP BY
      paciente_telefono_normalized,
      paciente_telefono,
      paciente_id,
      paciente_nombre,
      procedimiento_nombre';

    EXECUTE 'ALTER VIEW public.vw_doctoralia_patient_ltv SET (security_invoker = true)';

    EXECUTE '
    CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
    WITH whatsapp_stats AS (
      SELECT
        wc.lead_id,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) <> ''inbound'') > 0 AS has_outbound,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) = ''inbound'') > 0   AS has_inbound,
        MIN(wc.sent_at) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) <> ''inbound'') AS first_outbound_at,
        MIN(wc.sent_at) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) = ''inbound'')   AS first_inbound_at,
        AVG(
          EXTRACT(EPOCH FROM (wc.sent_at - prev.sent_at)) / 60
        ) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) = ''inbound'' AND prev.sent_at IS NOT NULL) AS avg_reply_delay_minutes
      FROM public.whatsapp_conversations wc
      LEFT JOIN LATERAL (
        SELECT sent_at
        FROM public.whatsapp_conversations prev
        WHERE prev.lead_id = wc.lead_id
          AND prev.sent_at < wc.sent_at
        ORDER BY prev.sent_at DESC
        LIMIT 1
      ) prev ON true
      GROUP BY wc.lead_id
    )
    SELECT
      COALESCE(u.id, l.user_id)                           AS user_id,
      COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown'') AS campaign_name,
      COALESCE(ma.campaign_id, l.campaign_id)             AS campaign_id,
      COALESCE(ma.adset_name, l.adset_name)               AS adset_name,
      COALESCE(ma.adset_id, l.adset_id)                   AS adset_id,
      COALESCE(ma.ad_name, l.ad_name)                     AS ad_name,
      COALESCE(ma.ad_id, l.ad_id)                         AS ad_id,

      COUNT(*)                                            AS total_leads,

      -- Real WhatsApp metrics
      COUNT(*) FILTER (WHERE ws.has_outbound)             AS contacted,
      COUNT(*) FILTER (WHERE ws.has_inbound)              AS replied,

      COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''scheduled'',''confirmed'',''showed'',''completed'')) AS booked,

      COUNT(*) FILTER (WHERE COALESCE(ut.attended_at, l.attended_at) IS NOT NULL
                        OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''showed'',''completed'')) AS attended,

      COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) AS no_shows,

      -- TODO: Real closed from financial_settlements when we have better linking
      COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) AS closed,

      COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) AS closed_won,

      ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_estimated, l.revenue)), 0), 2) AS estimated_revenue,
      ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_verified, l.verified_revenue)), 0), 2) AS verified_revenue_crm,

      -- Real reply rate
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE ws.has_inbound) /
        NULLIF(COUNT(*) FILTER (WHERE ws.has_outbound), 0), 1
      )                                                   AS reply_rate_pct,

      ROUND(
        100.0 * COUNT(*) FILTER (WHERE ws.has_inbound AND COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''scheduled'',''confirmed'',''showed'',''completed'')) /
        NULLIF(COUNT(*) FILTER (WHERE ws.has_inbound), 0), 1
      )                                                   AS replied_to_booked_pct,

      ROUND(
        100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) /
        NULLIF(COUNT(*), 0), 1
      )                                                   AS lead_to_close_rate_pct,

      ROUND(
        100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) /
        NULLIF(COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IS NOT NULL), 0), 1
      )                                                   AS no_show_rate_pct,

      ROUND(COALESCE(AVG(ws.avg_reply_delay_minutes), 0), 1) AS avg_reply_delay_min,

      MIN(COALESCE(ut.lead_created_at, l.created_at, ws.first_outbound_at)) AS first_lead_at,
      MAX(COALESCE(ut.lead_created_at, l.created_at, ws.first_outbound_at)) AS last_lead_at

    FROM public.leads l
    LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
      ON ut.lead_id = l.id
    LEFT JOIN public.meta_attribution ma
      ON ma.lead_id = l.id
    LEFT JOIN public.users u
      ON u.id = l.user_id
    LEFT JOIN whatsapp_stats ws
      ON ws.lead_id = l.id
    GROUP BY
      COALESCE(u.id, l.user_id),
      COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown''),
      COALESCE(ma.campaign_id, l.campaign_id),
      COALESCE(ma.adset_name, l.adset_name),
      COALESCE(ma.adset_id, l.adset_id),
      COALESCE(ma.ad_name, l.ad_name),
      COALESCE(ma.ad_id, l.ad_id)';

    EXECUTE 'ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true)';
    EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO service_role';
    EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO authenticated';

  END IF;
END $$;

COMMENT ON COLUMN public.leads.fbc IS 'Facebook Click ID captured at lead creation (for CAPI)';
COMMENT ON COLUMN public.leads.fbp IS 'Facebook Browser ID captured at lead creation (for CAPI)';
COMMENT ON COLUMN public.leads.capi_sent IS 'Whether a CAPI event has already been sent for this lead';
COMMENT ON COLUMN public.produccion_intermediarios.capi_sent IS 'Guard to prevent duplicate Purchase events to Meta CAPI';
