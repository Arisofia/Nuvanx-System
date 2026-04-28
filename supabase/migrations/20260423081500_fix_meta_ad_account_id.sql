-- Update Meta Ad Account ID for user a2f2b8a1-fedb-4a74-891d-b8a2089fd49a
-- The current act_9523446201036125 does not match the token, act_4172099716404860 does.

UPDATE integrations 
SET metadata = jsonb_set(
  jsonb_set(COALESCE(metadata, '{}'::jsonb), '{adAccountId}', '"act_4172099716404860"'),
  '{ad_account_id}', '"act_4172099716404860"'
)
WHERE user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a' 
AND service = 'meta';
