-- Persist attribution fields sent by external landing page and Google Ads form submissions.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS crm_stage TEXT,
  ADD COLUMN IF NOT EXISTS gclid TEXT,
  ADD COLUMN IF NOT EXISTS landing_url TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT;

COMMENT ON COLUMN public.leads.gclid IS 'Google Click Identifier received from external landing page or Google Ads forms.';
COMMENT ON COLUMN public.leads.landing_url IS 'Original landing page URL or referrer that generated the lead.';
COMMENT ON COLUMN public.leads.utm_source IS 'UTM source value from external lead capture forms.';
COMMENT ON COLUMN public.leads.utm_medium IS 'UTM medium value from external lead capture forms.';
COMMENT ON COLUMN public.leads.utm_campaign IS 'UTM campaign value from external lead capture forms.';
COMMENT ON COLUMN public.leads.utm_content IS 'UTM content value from external lead capture forms.';
COMMENT ON COLUMN public.leads.utm_term IS 'UTM term value from external lead capture forms.';
