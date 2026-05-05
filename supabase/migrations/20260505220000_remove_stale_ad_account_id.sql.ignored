-- Remove stale ad account id `act_9523446201036125` from integrations.metadata.
-- It was concatenated to the valid id (`act_4172099716404860,act_9523446201036125`)
-- which made backfill scripts attempt to fetch insights for an account the
-- system user token cannot access (Meta returns "Unsupported get request" /
-- "object does not exist or app does not have permission"). Only one ad account
-- exists for the Nuvanx Business Manager (id 878822511043717) and it is
-- act_4172099716404860, verified via GET /me/adaccounts on 2026-05-05.

UPDATE integrations
SET metadata = jsonb_set(metadata, '{adAccountId}', '"act_4172099716404860"'::jsonb)
WHERE service = 'meta'
  AND metadata->>'adAccountId' LIKE '%9523446201036125%';
