-- Advisor hardening: secure views + stable function search_path
-- Date: 2026-04-20

-- 1) Ensure public reporting views run with invoker privileges (respect caller RLS)
ALTER VIEW IF EXISTS public.v_whatsapp_funnel SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_campaign_roi SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_source_comparison SET (security_invoker = true);

-- 2) Ensure normalize_phone does not use mutable role search_path
DO $$
BEGIN
  IF to_regprocedure('public.normalize_phone(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.normalize_phone(text) SET search_path TO pg_catalog, public';
  END IF;
END
$$;
