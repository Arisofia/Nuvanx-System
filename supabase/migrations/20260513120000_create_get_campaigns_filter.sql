-- Migración: RPC para filtro de campañas
-- Esta migración elimina la versión antigua/broken de la función.
-- La implementación canónica se define más adelante en
-- 20260514090000_align_campaigns_filter_doctoralia_production.sql.

DROP FUNCTION IF EXISTS public.get_campaigns_filter(date, date);
