-- Ensure leads persist the Meta ad account identifier for deterministic CAPI routing.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ad_account_id TEXT;

COMMENT ON COLUMN public.leads.ad_account_id IS
  'Meta Ads account identifier attached at ingestion time (digits only, e.g. 9523446201036125). Used for attribution segmentation and CAPI routing.';

-- Backfill current null rows with operational fallback account until webhook payloads provide explicit value.
UPDATE public.leads
SET ad_account_id = '9523446201036125'
WHERE ad_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_ad_account_id
  ON public.leads (ad_account_id)
  WHERE ad_account_id IS NOT NULL;
