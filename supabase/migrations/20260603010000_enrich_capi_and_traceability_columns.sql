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
    DROP VIEW IF EXISTS public.vw_doctoralia_lead_traceability_unified;

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
      );
  END IF;
END $$;

COMMENT ON COLUMN public.leads.fbc IS 'Facebook Click ID captured at lead creation (for CAPI)';
COMMENT ON COLUMN public.leads.fbp IS 'Facebook Browser ID captured at lead creation (for CAPI)';
COMMENT ON COLUMN public.leads.capi_sent IS 'Whether a CAPI event has already been sent for this lead';
COMMENT ON COLUMN public.produccion_intermediarios.capi_sent IS 'Guard to prevent duplicate Purchase events to Meta CAPI';
