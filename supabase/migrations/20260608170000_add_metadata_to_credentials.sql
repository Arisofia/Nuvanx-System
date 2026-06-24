-- =============================================================
-- Add metadata column to credentials + wire Meta ad_account_ids
-- Root cause fix: daily-aggregates Edge Function reads
--   cred.metadata?.ad_account_ids which was always undefined
--   because credentials table had no metadata column.
-- =============================================================

DO $$
DECLARE
  has_required_columns BOOLEAN;
BEGIN
  IF to_regclass('public.credentials') IS NULL THEN
    RAISE NOTICE 'Skipping credentials metadata migration: public.credentials does not exist yet';
    RETURN;
  END IF;

  ALTER TABLE public.credentials
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

  SELECT COUNT(*) = 4
  INTO has_required_columns
  FROM unnest(ARRAY['clinic_id', 'metadata', 'service', 'user_id']) required(column_name)
  WHERE EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'credentials'
      AND c.column_name = required.column_name
  );

  IF has_required_columns IS DISTINCT FROM TRUE THEN
    RAISE NOTICE 'Skipping credentials metadata backfill: public.credentials is missing one or more required columns';
    RETURN;
  END IF;

  -- Link clinic to meta credentials
  UPDATE public.credentials
  SET clinic_id = '4207023b-eac1-4249-bf0f-d9b1e36a5d7a'
  WHERE service = 'meta' AND clinic_id IS NULL;

  -- Set ad_account_ids for primary user
  UPDATE public.credentials
  SET metadata = jsonb_build_object(
    'ad_account_ids', ARRAY['act_9523446201036125', 'act_4172099716404860']::text[],
    'ad_account_id',  'act_9523446201036125',
    'clinic_id',      '4207023b-eac1-4249-bf0f-d9b1e36a5d7a'
  )
  WHERE service = 'meta'
    AND user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a'
    AND (metadata = '{}'::jsonb OR metadata->>'ad_account_id' IS NULL);

  -- Set ad_account_ids for secondary user
  UPDATE public.credentials
  SET metadata = jsonb_build_object(
    'ad_account_ids', ARRAY['act_9523446201036125', 'act_4172099716404860']::text[],
    'ad_account_id',  'act_9523446201036125',
    'clinic_id',      '4207023b-eac1-4249-bf0f-d9b1e36a5d7a'
  )
  WHERE service = 'meta'
    AND user_id = '6692f0b3-f896-414b-b1c0-3eac943edd71'
    AND (metadata = '{}'::jsonb OR metadata->>'ad_account_id' IS NULL);
END $$;
