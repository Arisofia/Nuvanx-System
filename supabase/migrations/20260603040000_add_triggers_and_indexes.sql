-- =============================================================================
-- Triggers updated_at + Performance indexes (Point 5)
-- =============================================================================

-- 1. Ensure updated_at trigger function exists
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. Add updated_at triggers to Meta tables (if they exist and don't have the trigger yet)
DO $$
DECLARE
  meta_tables TEXT[] := ARRAY['meta_daily_insights', 'meta_attribution', 'meta_cache'];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY meta_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      -- Drop old trigger if exists with different name
      EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
      EXECUTE format('
        CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON public.%I
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
      ', t);
      RAISE NOTICE 'Added/ensured updated_at trigger on %', t;
    END IF;
  END LOOP;
END $$;

-- 3. Add useful indexes on leads (as requested)
DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    -- Meta Ads related
    CREATE INDEX IF NOT EXISTS idx_leads_meta_ad_id ON public.leads(meta_ad_id) WHERE meta_ad_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_leads_meta_form_id ON public.leads(meta_form_id) WHERE meta_form_id IS NOT NULL;

    -- Organic vs paid
    CREATE INDEX IF NOT EXISTS idx_leads_is_organic ON public.leads(is_organic) WHERE is_organic IS NOT NULL;

    -- Phone hashes (for fast matching) - only if columns exist
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'phone_sha256'
      ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_phone_sha256 ON public.leads USING hash (phone_sha256) WHERE phone_sha256 IS NOT NULL';
        RAISE NOTICE 'Created index idx_leads_phone_sha256';
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'phone_md5'
      ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leads_phone_md5 ON public.leads USING hash (phone_md5) WHERE phone_md5 IS NOT NULL';
        RAISE NOTICE 'Created index idx_leads_phone_md5';
      END IF;
    END $$;

    -- Composite for common queries
    CREATE INDEX IF NOT EXISTS idx_leads_user_campaign ON public.leads(user_id, campaign_id) WHERE deleted_at IS NULL;

    RAISE NOTICE 'Added performance indexes on leads table';
  END IF;
END $$;
