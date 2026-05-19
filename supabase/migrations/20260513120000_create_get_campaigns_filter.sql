-- Migración: RPC para filtro de campañas
-- Esta migración solo elimina la versión antigua de la función.
-- La implementación corregida está en: 20260514090000_align_campaigns_filter_doctoralia_production.sql

DROP FUNCTION IF EXISTS public.get_campaigns_filter();
