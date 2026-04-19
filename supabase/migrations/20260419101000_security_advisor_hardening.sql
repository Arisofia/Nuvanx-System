-- =============================================================================
-- Security advisor hardening
-- - RLS on public.kpi_blocked
-- - Security-invoker views (for views flagged as security definer)
-- - Immutable function search_path
-- =============================================================================

-- 1) RLS: public.kpi_blocked
ALTER TABLE IF EXISTS public.kpi_blocked ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_blocked_select_authenticated ON public.kpi_blocked;
CREATE POLICY kpi_blocked_select_authenticated
  ON public.kpi_blocked
  FOR SELECT
  TO authenticated
  USING (true);

-- 2) Views: force security invoker for all advisor-flagged views that exist
DO $$
DECLARE
  view_name TEXT;
  view_names TEXT[] := ARRAY[
    'v_whatsapp_funnel',
    'doctoralia_kpis',
    'vw_campaign_performance_real',
    'v_lead_traceability',
    'vw_whatsapp_conversion_real',
    'source_to_cash',
    'vw_doctor_performance_real',
    'vw_doctoralia_by_month',
    'vw_doctoralia_financials',
    'vw_lead_traceability',
    'v_campaign_roi'
  ];
BEGIN
  FOREACH view_name IN ARRAY view_names LOOP
    IF to_regclass(format('public.%I', view_name)) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', view_name);
    END IF;
  END LOOP;
END $$;

-- 3) Functions: lock down search_path
ALTER FUNCTION IF EXISTS public.set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.normalize_phone(TEXT) SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.leads_normalize_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.settlements_normalize_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.normalize_email(TEXT) SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.patients_normalize_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.reconcile_lead_to_patient(UUID) SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.reconcile_patient_leads(UUID) SET search_path = pg_catalog, public;
