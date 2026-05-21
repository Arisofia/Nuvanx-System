-- add_pixel_ids_and_actions_column
UPDATE integrations
SET metadata = jsonb_set(
  jsonb_set(
    jsonb_set(metadata, '{pixelIdGoya}', '"1405503384615251"'),
    '{pixelIdChamberi}', '"877262375461917"'
  ),
  '{adAccountIdGoya}', '"act_9523446201036125"'
)
WHERE service = 'meta';

ALTER TABLE meta_daily_insights
  ADD COLUMN IF NOT EXISTS actions JSONB,
  ADD COLUMN IF NOT EXISTS action_values JSONB,
  ADD COLUMN IF NOT EXISTS lead_actions INTEGER GENERATED ALWAYS AS (
    COALESCE((actions->'lead')::int, 0) +
    COALESCE((actions->'onsite_conversion.lead_grouped')::int, 0) +
    COALESCE((actions->'contact_total')::int, 0)
  ) STORED;
