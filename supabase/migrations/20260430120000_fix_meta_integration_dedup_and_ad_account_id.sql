-- Restore the canonical Meta integration row and fix the adAccountId.
-- Keep the best row for service = 'meta' and remove duplicate rows.

WITH ranked_meta AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY
        (metadata->>'adAccountId' = 'act_4172099716404860') DESC,
        updated_at DESC
    ) AS rn
  FROM integrations
  WHERE service = 'meta'
)
DELETE FROM integrations
WHERE id IN (SELECT id FROM ranked_meta WHERE rn > 1);

UPDATE integrations
SET metadata = jsonb_set(
  jsonb_set(COALESCE(metadata, '{}'::jsonb), '{adAccountId}', '"act_4172099716404860"'),
  '{ad_account_id}', '"act_4172099716404860"'
)
WHERE service = 'meta'
  AND (
    metadata->>'adAccountId' IS DISTINCT FROM 'act_4172099716404860'
    OR metadata->>'ad_account_id' IS DISTINCT FROM 'act_4172099716404860'
  );
