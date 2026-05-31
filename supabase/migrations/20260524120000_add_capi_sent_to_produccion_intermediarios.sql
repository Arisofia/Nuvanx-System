-- 20260524120000_add_capi_sent_to_produccion_intermediarios.sql
-- Add CAPI send guard flag to avoid duplicate Meta Purchase events.

ALTER TABLE public.produccion_intermediarios
  ADD COLUMN IF NOT EXISTS capi_sent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.produccion_intermediarios.capi_sent
  IS 'True when this production row has already been sent as a Meta CAPI Purchase event.';