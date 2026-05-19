-- Migración: RPC para filtro de campañas
-- Migración: Limpieza de RPC antiguo para filtro de campañas
-- Esta migración solo elimina la versión antigua de la función.
-- La implementación corregida está en: 20260514090000_align_campaigns_filter_doctoralia_production.sql

-- Eliminar cualquier versión previa de la función para asegurar una transición limpia
-- La nueva versión se define con parámetros DATE en la migración 20260514090000
DROP FUNCTION IF EXISTS public.get_campaigns_filter();
DROP FUNCTION IF EXISTS public.get_campaigns_filter(DATE, DATE);
