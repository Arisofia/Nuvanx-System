-- =============================================================================
-- Extend Produccion Intermediarios staging table (v2)
--
-- Adds missing columns according to the technical breakdown of May 2026.
-- =============================================================================

BEGIN;

ALTER TABLE public.produccion_intermediarios
  ADD COLUMN IF NOT EXISTS fecha_para_normalizar DATE,
  ADD COLUMN IF NOT EXISTS telefono_original TEXT,
  ADD COLUMN IF NOT EXISTS tipo_cliente TEXT,
  ADD COLUMN IF NOT EXISTS email_hubspot TEXT,
  ADD COLUMN IF NOT EXISTS ejecutivo_asignado TEXT,
  ADD COLUMN IF NOT EXISTS ingreso_lead TEXT,
  ADD COLUMN IF NOT EXISTS campana TEXT,
  ADD COLUMN IF NOT EXISTS dia INTEGER,
  ADD COLUMN IF NOT EXISTS mes INTEGER,
  ADD COLUMN IF NOT EXISTS ano INTEGER;

COMMENT ON COLUMN public.produccion_intermediarios.fecha_para_normalizar IS 'Copy of fecha for internal calculations/pivot tables.';
COMMENT ON COLUMN public.produccion_intermediarios.telefono_original IS 'Raw phone number as it appears in the source.';
COMMENT ON COLUMN public.produccion_intermediarios.tipo_cliente IS 'Lead or Cliente nuevo.';
COMMENT ON COLUMN public.produccion_intermediarios.ingreso_lead IS 'Technical entry date into CRM (often Excel serial).';
COMMENT ON COLUMN public.produccion_intermediarios.campana IS 'Marketing campaign name.';

COMMIT;
