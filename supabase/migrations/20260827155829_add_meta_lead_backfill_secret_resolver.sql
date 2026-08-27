-- Service-role-only resolver for the Meta token used by the dedicated lead backfill.
-- The secret value never leaves server-side runtime code.

CREATE OR REPLACE FUNCTION public.nvx_get_meta_lead_backfill_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT s.decrypted_secret
  FROM vault.decrypted_secrets AS s
  WHERE s.name IN ('META_API_TOKEN_AGOSTO_2026', 'META_TOKEN', 'META_REPORTING_TOKEN_60D')
    AND NULLIF(btrim(s.decrypted_secret), '') IS NOT NULL
  ORDER BY CASE s.name
    WHEN 'META_API_TOKEN_AGOSTO_2026' THEN 1
    WHEN 'META_TOKEN' THEN 2
    WHEN 'META_REPORTING_TOKEN_60D' THEN 3
    ELSE 99
  END
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.nvx_get_meta_lead_backfill_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_get_meta_lead_backfill_token() FROM anon;
REVOKE ALL ON FUNCTION public.nvx_get_meta_lead_backfill_token() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_get_meta_lead_backfill_token() TO service_role;
