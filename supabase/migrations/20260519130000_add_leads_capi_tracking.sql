-- Add CAPI tracking columns to leads table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
    -- Añadir columnas de trazabilidad si no existen
    ALTER TABLE public.leads 
      ADD COLUMN IF NOT EXISTS enviado_a_meta BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS fbc TEXT,
      ADD COLUMN IF NOT EXISTS fbp TEXT,
      ADD COLUMN IF NOT EXISTS ip_address TEXT,
      ADD COLUMN IF NOT EXISTS user_agent TEXT;

    -- Index for efficient CAPI polling/automation
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'leads' AND indexname = 'idx_leads_no_enviados') THEN
      CREATE INDEX idx_leads_no_enviados 
        ON public.leads (enviado_a_meta) 
        WHERE enviado_a_meta = FALSE;
    END IF;

    -- Add comments for clarity
    COMMENT ON COLUMN public.leads.enviado_a_meta IS 'Indica si el lead ya fue procesado por la Conversions API de Meta';
    COMMENT ON COLUMN public.leads.fbc IS 'Meta Click ID (fbclid) formatted for CAPI';
    COMMENT ON COLUMN public.leads.fbp IS 'Meta Browser ID (_fbp) from cookies';
  ELSE
    RAISE NOTICE 'La tabla leads no existe, saltando configuración de CAPI.';
  END IF;
END $$;
