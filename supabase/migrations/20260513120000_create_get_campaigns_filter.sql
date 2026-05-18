-- Migración: RPC para filtro de campañas
-- Esta migración solo elimina la versión antigua/broken de la función.
-- La implementación canónica corregida se encuentra en la migración:
-- 20260514090000_align_campaigns_filter_doctoralia_production.sql

DROP FUNCTION IF EXISTS get_campaigns_filter(date, date);
