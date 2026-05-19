<<<<<<< HEAD
=======
-- 20260513120000_create_get_campaigns_filter.sql
>>>>>>> main
-- Migración: RPC para filtro de campañas
-- Esta migración elimina la versión antigua/broken de la función.
-- La implementación canónica se define más adelante en
-- 20260514090000_align_campaigns_filter_doctoralia_production.sql.

<<<<<<< HEAD
DROP FUNCTION IF EXISTS public.get_campaigns_filter(date, date);
=======
DROP FUNCTION IF EXISTS public.get_campaigns_filter(date, date);
>>>>>>> main
