-- De-duplicate leads attribution fields
-- We keep meta_* fields as the explicit canonical source for Meta leads.
-- We drop the redundant non-prefixed fields that were duplicates.

DO $$
BEGIN
  -- ad_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'ad_id') THEN
    BEGIN
      ALTER TABLE public.leads DROP COLUMN ad_id;
    EXCEPTION
      WHEN SQLSTATE '2BP01' THEN
        RAISE NOTICE 'Skipping DROP public.leads.ad_id (dependent objects exist).';
    END;
  END IF;

  -- ad_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'ad_name') THEN
    BEGIN
      ALTER TABLE public.leads DROP COLUMN ad_name;
    EXCEPTION
      WHEN SQLSTATE '2BP01' THEN
        RAISE NOTICE 'Skipping DROP public.leads.ad_name (dependent objects exist).';
    END;
  END IF;

  -- form_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'form_id') THEN
    BEGIN
      ALTER TABLE public.leads DROP COLUMN form_id;
    EXCEPTION
      WHEN SQLSTATE '2BP01' THEN
        RAISE NOTICE 'Skipping DROP public.leads.form_id (dependent objects exist).';
    END;
  END IF;

  -- form_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'form_name') THEN
    BEGIN
      ALTER TABLE public.leads DROP COLUMN form_name;
    EXCEPTION
      WHEN SQLSTATE '2BP01' THEN
        RAISE NOTICE 'Skipping DROP public.leads.form_name (dependent objects exist).';
    END;
  END IF;
END $$;
