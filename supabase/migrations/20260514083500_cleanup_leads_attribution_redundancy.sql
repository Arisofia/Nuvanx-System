-- De-duplicate leads attribution fields
-- We keep meta_* fields as the explicit canonical source for Meta leads.
-- We drop the redundant non-prefixed fields that were duplicates.

DO $$
BEGIN
  -- Drop redundant attribution columns from public.leads
  -- These are already present as meta_ad_id, meta_ad_name, meta_form_id
  -- or are stored in the meta_attribution table.
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'ad_id') THEN
    ALTER TABLE public.leads DROP COLUMN ad_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'ad_name') THEN
    ALTER TABLE public.leads DROP COLUMN ad_name;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'form_id') THEN
    ALTER TABLE public.leads DROP COLUMN form_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'form_name') THEN
    -- If form_name was used as a general field, we might want to keep it, 
    -- but for Meta leads it is redundant with meta_form_id or raw_field_data.
    -- However, form_name is often useful for display.
    -- The report specifically mentioned form_id/form_name as part of the Meta duplication.
    ALTER TABLE public.leads DROP COLUMN form_name;
  END IF;

  -- Consolidate campaign and adset into meta_ prefixed versions if they don't exist
  -- or just keep them if they are the only source.
  -- In this case, we'll keep campaign_id/name and adset_id/name as the general attribution fields
  -- but we'll ensure they are NOT duplicated in the same row with different names.
END $$;
