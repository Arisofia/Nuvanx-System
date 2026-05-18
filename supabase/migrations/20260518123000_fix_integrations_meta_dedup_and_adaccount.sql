-- =============================================================================
-- Fix Meta integration integrity for the production Francisco account.
--
-- Restores the active Meta ad account, keeps the known page id, removes duplicate
-- meta integration rows for the same user/service pair, and adds a unique guard
-- so future upserts cannot create duplicated integrations again.
-- =============================================================================

DO $$
DECLARE
  target_user_id UUID := 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a';
  correct_ad_account_id TEXT := 'act_4172099716404860';
  correct_page_id TEXT := '685010274687129';
BEGIN
  IF to_regclass('public.integrations') IS NULL THEN
    RAISE NOTICE 'Skipping Meta integration dedup: public.integrations does not exist yet.';
    RETURN;
  END IF;

  UPDATE public.integrations
  SET metadata = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{adAccountId}',
                  to_jsonb(correct_ad_account_id)
                ),
                '{ad_account_id}',
                to_jsonb(correct_ad_account_id)
              ),
              '{adAccountIds}',
              to_jsonb(ARRAY[correct_ad_account_id]::TEXT[])
            ),
            '{ad_account_ids}',
            to_jsonb(ARRAY[correct_ad_account_id]::TEXT[])
          ),
          '{pageId}',
          to_jsonb(correct_page_id)
        ),
        '{page_id}',
        to_jsonb(correct_page_id)
      ),
      status = 'connected',
      updated_at = NOW()
  WHERE service = 'meta'
    AND user_id = target_user_id;

  WITH ranked_integrations AS (
    SELECT
      ctid,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, service
        ORDER BY
          CASE
            WHEN user_id = target_user_id
             AND service = 'meta'
             AND metadata->>'adAccountId' = correct_ad_account_id THEN 0
            ELSE 1
          END,
          updated_at DESC NULLS LAST,
          created_at DESC NULLS LAST,
          ctid DESC
      ) AS row_rank
    FROM public.integrations
  )
  DELETE FROM public.integrations i
  USING ranked_integrations r
  WHERE i.ctid = r.ctid
    AND r.row_rank > 1;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS integrations_user_id_service_unique_idx ON public.integrations (user_id, service)';
END $$;
