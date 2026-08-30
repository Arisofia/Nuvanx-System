ALTER TABLE public.meta_attribution
  ADD COLUMN IF NOT EXISTS leadgen_id text,
  ADD COLUMN IF NOT EXISTS page_id text,
  ADD COLUMN IF NOT EXISTS form_id text;

CREATE UNIQUE INDEX IF NOT EXISTS meta_attribution_leadgen_id_uidx
  ON public.meta_attribution (leadgen_id)
  WHERE leadgen_id IS NOT NULL;

ALTER TABLE public.meta_daily_insights
  ADD COLUMN IF NOT EXISTS source_quality text;
