-- Remove legacy plaintext Google Ads developer-token copies from existing
-- integration metadata.
--
-- This migration intentionally performs data cleanup only. The immediately
-- following migration installs the write sanitizer first and only then adds the
-- database CHECK invariant, so legacy clients cannot be broken between a
-- credential write and an integration upsert.

BEGIN;

UPDATE public.integrations
SET metadata = COALESCE(metadata, '{}'::jsonb) - 'developer_token' - 'developerToken',
    updated_at = NOW()
WHERE service = 'google_ads'
  AND (
    COALESCE(metadata, '{}'::jsonb) ? 'developer_token'
    OR COALESCE(metadata, '{}'::jsonb) ? 'developerToken'
  );

COMMIT;
