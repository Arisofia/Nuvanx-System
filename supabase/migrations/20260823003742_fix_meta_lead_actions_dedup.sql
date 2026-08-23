-- Canonicalize Meta daily lead reporting without double-counting overlapping action aliases.
ALTER TABLE public.meta_daily_insights
  DROP COLUMN lead_actions;

ALTER TABLE public.meta_daily_insights
  ADD COLUMN lead_actions INTEGER GENERATED ALWAYS AS (
    COALESCE(
      NULLIF((actions->>'lead')::integer, 0),
      NULLIF((actions->>'onsite_conversion.lead_grouped')::integer, 0),
      NULLIF((actions->>'contact_total')::integer, 0),
      0
    )
  ) STORED;

COMMENT ON COLUMN public.meta_daily_insights.lead_actions IS
  'Canonical Meta lead count per daily row. Uses lead first, lead_grouped as fallback, then legacy contact_total; never sums overlapping action aliases.';
