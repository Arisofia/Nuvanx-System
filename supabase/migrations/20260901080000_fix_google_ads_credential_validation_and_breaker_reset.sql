-- Fix Google Ads Credential Validation and Reset Circuit Breaker
--
-- Confirmed Root Cause:
--   credentials.encrypted_key stores the AES-GCM encrypted Google Ads developer token (~167 hex chars).
--   The GCP Service Account JSON is provided via Deno environment variable GOOGLE_ADS_SERVICE_ACCOUNT.
--   Dropping check_google_ads_credential_length ensures the developer token is not rejected.

ALTER TABLE public.credentials
DROP CONSTRAINT IF EXISTS check_google_ads_credential_length;

-- Reset circuit breaker for Google Ads provider
UPDATE public.control_centre_provider_cache
SET breaker_state = 'half_open',
    failure_count = 0,
    breaker_open_until = NULL
WHERE provider = 'google';

DO $$
BEGIN
  RAISE NOTICE 'Google Ads developer token in credentials.encrypted_key preserved; circuit breaker reset to half_open.';
END $$;
