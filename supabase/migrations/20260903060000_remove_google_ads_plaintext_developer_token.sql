-- Remove legacy plaintext Google Ads developer-token copies from integration metadata
-- and make their absence a database invariant.
--
-- The canonical Google Ads credential is owned by the Production Edge runtime and
-- stored encrypted in public.credentials. Integration metadata must never be used
-- as a second plaintext secret store.
--
-- Existing clients may still submit one of the historical metadata aliases. Strip
-- those keys at the table boundary before constraints run so a legacy request cannot
-- leave credential/integration connection state partially persisted.

BEGIN;

UPDATE public.integrations
SET metadata = COALESCE(metadata, '{}'::jsonb) - 'developer_token' - 'developerToken',
    updated_at = NOW()
WHERE service = 'google_ads'
  AND (
    COALESCE(metadata, '{}'::jsonb) ? 'developer_token'
    OR COALESCE(metadata, '{}'::jsonb) ? 'developerToken'
  );

CREATE OR REPLACE FUNCTION public.nvx_strip_google_ads_plaintext_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.service = 'google_ads' THEN
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) - 'developer_token' - 'developerToken';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS integrations_strip_google_ads_plaintext_metadata
  ON public.integrations;

CREATE TRIGGER integrations_strip_google_ads_plaintext_metadata
BEFORE INSERT OR UPDATE ON public.integrations
FOR EACH ROW
EXECUTE FUNCTION public.nvx_strip_google_ads_plaintext_metadata();

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
