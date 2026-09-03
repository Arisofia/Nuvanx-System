-- Remove legacy plaintext Google Ads developer-token copies from integration metadata
-- and make their absence a database invariant.
--
-- The canonical Google Ads credential is owned by the Production Edge runtime and
-- stored encrypted in public.credentials. Integration metadata must never be used
-- as a second plaintext secret store.

BEGIN;

UPDATE public.integrations
SET metadata = COALESCE(metadata, '{}'::jsonb) - 'developer_token' - 'developerToken',
    updated_at = NOW()
WHERE service = 'google_ads'
  AND (
    COALESCE(metadata, '{}'::jsonb) ? 'developer_token'
    OR COALESCE(metadata, '{}'::jsonb) ? 'developerToken'
  );

ALTER TABLE public.integrations
  DROP CONSTRAINT IF EXISTS integrations_google_ads_no_plaintext_developer_token;

ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_google_ads_no_plaintext_developer_token
  CHECK (
    service <> 'google_ads'
    OR (
      NOT (COALESCE(metadata, '{}'::jsonb) ? 'developer_token')
      AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'developerToken')
    )
  );

COMMIT;
