-- Migración: RPC para filtro de campañas
-- Esta migración solo elimina la versión antigua/broken de la función.
-- La implementación canónica corregida se encuentra en la migración:
-- 20260514090000_align_campaigns_filter_doctoralia_production.sql

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 5b30926 (chore: resolve script conflicts and integrate clinic discovery helpers)
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
<<<<<<< HEAD
=======
DROP FUNCTION IF EXISTS get_campaigns_filter;
>>>>>>> 43c7e50 (chore: resolve deploy.yml and get_campaigns_filter conflicts)
=======
>>>>>>> 5b30926 (chore: resolve script conflicts and integrate clinic discovery helpers)
