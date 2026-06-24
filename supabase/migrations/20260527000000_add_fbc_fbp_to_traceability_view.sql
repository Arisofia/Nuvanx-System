-- 20260527000000_add_fbc_fbp_to_traceability_view.sql
-- Enrich the unified traceability view with fbc/fbp from leads table.
-- This improves EMQ for CAPI Purchase events fired from handleSupabaseWebhook
-- when processing 'Pagada' productions (Doctoralia financial settlements).

DO $$
BEGIN
  -- Only alter if the view exists
  IF to_regclass('public.vw_doctoralia_lead_traceability_unified') IS NOT NULL THEN
    -- We recreate the view definition with fbc/fbp included.
    -- This is safe because the previous version already had conditional logic for meta_attribution.
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.vw_doctoralia_lead_traceability_unified AS
      SELECT
        dr.*,
        COALESCE(
          normalize_phone(dr.paciente_telefono),
          normalize_phone(dr.phone_primary),
          normalize_phone(dr.phone_secondary)
        ) AS paciente_telefono_normalized,
        l.id                  AS lead_id,
        l.external_id         AS leadgen_id,
        l.name                AS lead_full_name,
        l.phone               AS lead_phone,
        l.phone_normalized    AS lead_phone_normalized,
        l.source              AS lead_source,
        l.stage               AS lead_stage,
        l.created_at          AS lead_created_at,
        COALESCE(m.campaign_name, l.campaign_name) AS campaign_name,
        COALESCE(m.ad_name, l.ad_name) AS ad_name,
        l.form_name           AS form_name,
        m.campaign_id,
        m.adset_id,
        m.adset_name,
        m.ad_id,
        l.revenue             AS lead_revenue_estimated,
        l.verified_revenue    AS lead_revenue_verified,
        COALESCE(
          dr.estado::TEXT,
          l.appointment_status
        ) AS appointment_status,
        COALESCE(dr.timestamp_cita, l.attended_at) AS attended_at,
        COALESCE(CASE WHEN dr.estado = 'No presentado' THEN true ELSE NULL END, l.no_show_flag) AS no_show_flag,
        l.converted_patient_id AS lead_converted_patient_id,
        l.priority            AS lead_priority,
        -- CAPI attribution fields for high EMQ on server-side events (Purchase, Lead, etc.)
        l.fbc                 AS lead_fbc,
        l.fbp                 AS lead_fbp
      FROM public.vw_doctoralia_trazabilidad_360 dr
      LEFT JOIN public.leads l
        ON (
          normalize_phone(dr.paciente_telefono) = l.phone_normalized
          OR normalize_phone(dr.phone_primary)  = l.phone_normalized
          OR normalize_phone(dr.phone_secondary) = l.phone_normalized
        )
      LEFT JOIN public.meta_attribution m
        ON m.lead_id = l.id;
    $view$;
  END IF;
END $$;

ALTER VIEW public.vw_doctoralia_lead_traceability_unified
  SET (security_invoker = true);

COMMENT ON COLUMN public.vw_doctoralia_lead_traceability_unified.lead_fbc IS 'Meta fbc (fbclid) captured at lead time - critical for CAPI EMQ';
COMMENT ON COLUMN public.vw_doctoralia_lead_traceability_unified.lead_fbp IS 'Meta fbp (_fbp) captured at lead time - critical for CAPI EMQ';