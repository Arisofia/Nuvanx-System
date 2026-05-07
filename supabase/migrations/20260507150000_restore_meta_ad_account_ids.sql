-- Restore both historical and active Meta ad accounts for Francisco's integration.
-- Ensures the integration metadata contains both adAccountIds and keeps the
-- primary adAccountId pointing to the currently active account.

UPDATE integrations
SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{adAccountIds}',
            '["act_9523446201036125","act_4172099716404860"]'::jsonb
          ),
          '{ad_account_ids}',
          '["act_9523446201036125","act_4172099716404860"]'::jsonb
        ),
        '{adAccountId}',
        '"act_9523446201036125"'::jsonb
      ),
      '{ad_account_id}',
      '"act_9523446201036125"'::jsonb
    )
WHERE service = 'meta'
  AND user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a';

-- To update the stored Meta access token for the same user, encrypt the
-- new token using the repository ENCRYPTION_KEY and then update the
-- credentials table. Example:
--
-- UPDATE credentials
-- SET encrypted_key = '<NEW_ENCRYPTED_VALUE>'
-- WHERE service = 'meta'
--   AND user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a';
