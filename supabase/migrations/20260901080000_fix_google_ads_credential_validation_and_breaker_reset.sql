-- Fix Google Ads Credential Validation and Reset Circuit Breaker

-- Add check constraint to ensure Google Ads credentials are not truncated
ALTER TABLE public.credentials
ADD CONSTRAINT check_google_ads_credential_length 
CHECK (service <> 'google_ads' OR length(encrypted_key) >= 400);

-- Reset circuit breaker for Google Ads provider
UPDATE public.control_centre_provider_cache
SET breaker_state = 'half_open',
    failure_count = 0,
    breaker_open_until = NULL
WHERE provider = 'google';

-- Update integration status
UPDATE public.integrations
SET status = 'credential_invalid'
WHERE service = 'google_ads';

DO $$
BEGIN
  RAISE NOTICE 'Please manually update the encrypted_key for google_ads in the credentials table with the full Service Account JSON. Example: UPDATE public.credentials SET encrypted_key = ''<FULL_JSON>'' WHERE service = ''google_ads'' AND length(encrypted_key) < 400;';
END $$;
