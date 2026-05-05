-- Restore correct ad account id `act_9523446201036125` for Francisco's integration.
-- The previous migration mistakenly identified it as stale/inaccessible, 
-- but it is the account containing active campaigns and valid leads.

UPDATE integrations
SET metadata = jsonb_set(metadata, '{adAccountId}', '"act_9523446201036125"'::jsonb)
WHERE service = 'meta'
  AND (
    metadata->>'adAccountId' = 'act_4172099716404860' 
    OR user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a'
  );
