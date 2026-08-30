-- Replace the ineffective generated CASE with a compatibility alias derived only
-- from the canonical ad_account_id SSOT. Keep the column to avoid breaking legacy readers.

ALTER TABLE public.leads
  ALTER COLUMN cuenta_id DROP EXPRESSION IF EXISTS;

CREATE OR REPLACE FUNCTION public.nvx_sync_lead_cuenta_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.cuenta_id := CASE
    WHEN NULLIF(btrim(NEW.ad_account_id), '') IS NULL THEN NULL
    WHEN btrim(NEW.ad_account_id) ~ '^act_[0-9]+$' THEN btrim(NEW.ad_account_id)
    WHEN btrim(NEW.ad_account_id) ~ '^[0-9]+$' THEN 'act_' || btrim(NEW.ad_account_id)
    ELSE NULL
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_nvx_sync_lead_cuenta_id ON public.leads;
CREATE TRIGGER trg_nvx_sync_lead_cuenta_id
BEFORE INSERT OR UPDATE OF ad_account_id, cuenta_id ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.nvx_sync_lead_cuenta_id();

UPDATE public.leads
SET cuenta_id = CASE
  WHEN NULLIF(btrim(ad_account_id), '') IS NULL THEN NULL
  WHEN btrim(ad_account_id) ~ '^act_[0-9]+$' THEN btrim(ad_account_id)
  WHEN btrim(ad_account_id) ~ '^[0-9]+$' THEN 'act_' || btrim(ad_account_id)
  ELSE NULL
END;

COMMENT ON COLUMN public.leads.cuenta_id IS
'Legacy compatibility alias normalized from ad_account_id. ad_account_id is the canonical advertising-account SSOT.';

REVOKE ALL ON FUNCTION public.nvx_sync_lead_cuenta_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nvx_sync_lead_cuenta_id() TO service_role;
