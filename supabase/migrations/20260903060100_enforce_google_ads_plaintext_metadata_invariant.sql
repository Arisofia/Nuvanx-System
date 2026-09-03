-- Enforce the Google Ads integration-metadata secret boundary for all future
-- writes without breaking legacy clients that still submit historical aliases.
--
-- The BEFORE trigger strips reserved aliases before table constraints evaluate.
-- The cleanup UPDATE closes the race between the preceding cleanup-only migration
-- and trigger installation. The CHECK constraint remains as defense in depth.
--
-- Only JSON objects participate in this legacy-key contract. Arrays/scalars are
-- left unchanged because JSONB key operators have different semantics on arrays.
-- Preserve updated_at during cleanup so secret removal cannot alter account routing.

BEGIN;

CREATE OR REPLACE FUNCTION public.nvx_strip_google_ads_plaintext_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.service = 'google_ads'
     AND jsonb_typeof(NEW.metadata) = 'object' THEN
    NEW.metadata := NEW.metadata - 'developer_token' - 'developerToken';
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

UPDATE public.integrations
SET metadata = metadata - 'developer_token' - 'developerToken'
WHERE service = 'google_ads'
  AND jsonb_typeof(metadata) = 'object'
  AND (
    metadata ? 'developer_token'
    OR metadata ? 'developerToken'
  );

ALTER TABLE public.integrations
  DROP CONSTRAINT IF EXISTS integrations_google_ads_no_plaintext_developer_token;

ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_google_ads_no_plaintext_developer_token
  CHECK (
    service <> 'google_ads'
    OR jsonb_typeof(metadata) <> 'object'
    OR (
      NOT (metadata ? 'developer_token')
      AND NOT (metadata ? 'developerToken')
    )
  );

COMMIT;
