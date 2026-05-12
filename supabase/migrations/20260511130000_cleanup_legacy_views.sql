-- =============================================================================
-- 20260511130000_cleanup_legacy_views.sql
-- 
-- CLEANUP AND SIMPLIFICATION OF VIEWS
-- 1. Drops legacy views with old naming convention (v_*)
-- 2. Drops intermediate/unused views to simplify the schema
-- 3. Ensures all active views have security_invoker = true
-- =============================================================================

-- 1. Drop strictly legacy views (superseded by vw_*_real or unified logic)
DROP VIEW IF EXISTS public.v_campaign_roi CASCADE;
DROP VIEW IF EXISTS public.v_whatsapp_funnel CASCADE;

-- 2. Drop intermediate/unused views
DROP VIEW IF EXISTS public.vw_doctoralia_lead_traceability_unified CASCADE;
DROP VIEW IF EXISTS public.vw_doctoralia_trazabilidad_360 CASCADE;
DROP VIEW IF EXISTS public.vw_doctoralia_patient_ltv CASCADE;

-- 3. Re-verify security_invoker on all active views
-- (Just in case they were reset or created without it)
ALTER VIEW IF EXISTS public.vw_lead_traceability          SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_campaign_performance_real SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_whatsapp_conversion_real  SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_doctor_performance_real   SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_source_comparison         SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_doctoralia_financials     SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_doctoralia_by_month       SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_produccion_intermediarios_kpis      SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_produccion_intermediarios_by_agenda SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_produccion_intermediarios_by_proc   SET (security_invoker = true);

-- Add comments for the remaining views to clarify their purpose
COMMENT ON VIEW public.vw_lead_traceability IS 'Main traceability view connecting leads to patients and settlements.';
COMMENT ON VIEW public.vw_campaign_performance_real IS 'Marketing performance metrics by campaign and source.';
COMMENT ON VIEW public.vw_whatsapp_conversion_real IS 'Funnel analysis for WhatsApp leads.';
COMMENT ON VIEW public.vw_doctor_performance_real IS 'Performance metrics for doctors and specialties.';
COMMENT ON VIEW public.vw_source_comparison IS 'Comparison of conversion performance between different lead sources.';
