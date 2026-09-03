-- Remove legacy plaintext Google Ads developer-token copies from existing
-- integration metadata.
--
-- This migration intentionally performs data cleanup only. The immediately
-- following migration installs the write sanitizer first and only then adds the
-- database CHECK invariant, so legacy clients cannot be broken between a
-- credential write and an integration upsert.
--
-- Preserve updated_at: downstream routing uses that timestamp, and removing a
-- legacy secret must not change integration recency or account selection.
-- Restrict cleanup to JSON objects so array/string metadata is never reinterpreted
-- as an object-key store.

BEGIN;

UPDATE public.integrations
SET metadata = metadata - 'developer_token' - 'developerToken'
WHERE service = 'google_ads'
  AND jsonb_typeof(metadata) = 'object'
  AND (
    metadata ? 'developer_token'
    OR metadata ? 'developerToken'
  );

COMMIT;
