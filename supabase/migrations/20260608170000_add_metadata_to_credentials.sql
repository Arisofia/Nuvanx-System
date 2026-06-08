-- =============================================================
-- Add metadata column to credentials + wire Meta ad_account_ids
-- Root cause fix: daily-aggregates Edge Function reads
--   cred.metadata?.ad_account_ids which was always undefined
--   because credentials table had no metadata column.
-- =============================================================

ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

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
