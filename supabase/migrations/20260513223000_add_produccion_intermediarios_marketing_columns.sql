-- =============================================================================
-- Add Produccion Intermediarios marketing compatibility columns
--
-- Supabase Preview only applies new migration files on every commit. This
-- forward-only migration adds integration aliases requested during conflict
-- resolution to preview databases where the base table migration already ran.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    ALTER TABLE public.produccion_intermediarios
      ADD COLUMN IF NOT EXISTS campaign_id TEXT,
      ADD COLUMN IF NOT EXISTS agenda_name TEXT,
      ADD COLUMN IF NOT EXISTS room_id TEXT,
      ADD COLUMN IF NOT EXISTS lead_source TEXT;

    CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_campaign_id
      ON public.produccion_intermediarios (campaign_id)
      WHERE campaign_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_lead_source
      ON public.produccion_intermediarios (lead_source)
      WHERE lead_source IS NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping produccion_intermediarios marketing columns: table does not exist';
  END IF;
END $$;
