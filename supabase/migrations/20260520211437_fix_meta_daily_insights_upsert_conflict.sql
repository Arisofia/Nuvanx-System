-- fix_meta_daily_insights_upsert_conflict
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_daily_insights_account_date_unique'
  ) THEN
    ALTER TABLE meta_daily_insights
      ADD CONSTRAINT meta_daily_insights_account_date_unique
      UNIQUE (ad_account_id, date, user_id);
  END IF;
END $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS cuenta_id TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN campaign_id ILIKE '%9523446201036125%' THEN 'act_9523446201036125'
      WHEN campaign_id ILIKE '%4172099716404860%' THEN 'act_4172099716404860'
      WHEN adset_id    ILIKE '%9523446201036125%' THEN 'act_9523446201036125'
      WHEN adset_id    ILIKE '%4172099716404860%' THEN 'act_4172099716404860'
      ELSE NULL
    END
  ) STORED;
