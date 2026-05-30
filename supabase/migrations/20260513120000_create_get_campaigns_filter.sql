-- Migración: RPC para filtro de campañas
-- Esta migración elimina la versión antigua/broken de la función.
-- La implementación canónica se define más adelante en
-- 20260514090000_align_campaigns_filter_doctoralia_production.sql.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_campaigns_filter'
      AND p.pronargs = 2
  ) THEN
    DROP FUNCTION public.get_campaigns_filter(date, date);
  END IF;
END $$ LANGUAGE plpgsql;
