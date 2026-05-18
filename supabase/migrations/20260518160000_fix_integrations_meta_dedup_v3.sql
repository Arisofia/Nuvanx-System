-- fix_integrations_meta_dedup_v3
-- Canonicalize Meta integration rows after duplicate writes polluted singular
-- adAccountId fields with comma-joined account IDs. Keep the array fields for
-- explicit multi-account support, but enforce one scalar primary account ID.

DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  segment TEXT;
  digits TEXT;
  accounts TEXT[];
  selected_account TEXT;
  selected_page TEXT;
BEGIN
  -- Prefer the row with page context, then connected status, then latest update.
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, service
        ORDER BY
          NULLIF(regexp_replace(COALESCE(metadata->>'pageId', metadata->>'page_id', ''), '\D', '', 'g'), '') IS NOT NULL DESC,
          (status = 'connected') DESC,
          updated_at DESC NULLS LAST,
          id DESC
      ) AS rn
    FROM public.integrations
    WHERE service = 'meta'
  )
  DELETE FROM public.integrations i
  USING ranked r
  WHERE i.id = r.id
    AND r.rn > 1;

  FOR rec IN
    SELECT id, metadata
    FROM public.integrations
    WHERE service = 'meta'
  LOOP
    accounts := ARRAY[]::TEXT[];

    FOREACH candidate IN ARRAY ARRAY[
      rec.metadata->>'adAccountId',
      rec.metadata->>'ad_account_id',
      rec.metadata->>'accountId',
      rec.metadata->>'account_id'
    ] LOOP
      IF candidate IS NULL OR btrim(candidate) = '' THEN
        CONTINUE;
      END IF;

      FOREACH segment IN ARRAY regexp_split_to_array(candidate, '[\s,;]+') LOOP
        digits := regexp_replace(COALESCE(segment, ''), '\D', '', 'g');
        IF digits <> '' AND NOT ('act_' || digits = ANY(accounts)) THEN
          accounts := accounts || ('act_' || digits);
        END IF;
      END LOOP;
    END LOOP;

    IF jsonb_typeof(rec.metadata->'adAccountIds') = 'array' THEN
      FOR candidate IN SELECT jsonb_array_elements_text(rec.metadata->'adAccountIds') LOOP
        FOREACH segment IN ARRAY regexp_split_to_array(candidate, '[\s,;]+') LOOP
          digits := regexp_replace(COALESCE(segment, ''), '\D', '', 'g');
          IF digits <> '' AND NOT ('act_' || digits = ANY(accounts)) THEN
            accounts := accounts || ('act_' || digits);
          END IF;
        END LOOP;
      END LOOP;
    ELSIF rec.metadata ? 'adAccountIds' THEN
      candidate := rec.metadata->>'adAccountIds';
      FOREACH segment IN ARRAY regexp_split_to_array(COALESCE(candidate, ''), '[\s,;]+') LOOP
        digits := regexp_replace(COALESCE(segment, ''), '\D', '', 'g');
        IF digits <> '' AND NOT ('act_' || digits = ANY(accounts)) THEN
          accounts := accounts || ('act_' || digits);
        END IF;
      END LOOP;
    END IF;

    IF jsonb_typeof(rec.metadata->'ad_account_ids') = 'array' THEN
      FOR candidate IN SELECT jsonb_array_elements_text(rec.metadata->'ad_account_ids') LOOP
        FOREACH segment IN ARRAY regexp_split_to_array(candidate, '[\s,;]+') LOOP
          digits := regexp_replace(COALESCE(segment, ''), '\D', '', 'g');
          IF digits <> '' AND NOT ('act_' || digits = ANY(accounts)) THEN
            accounts := accounts || ('act_' || digits);
          END IF;
        END LOOP;
      END LOOP;
    ELSIF rec.metadata ? 'ad_account_ids' THEN
      candidate := rec.metadata->>'ad_account_ids';
      FOREACH segment IN ARRAY regexp_split_to_array(COALESCE(candidate, ''), '[\s,;]+') LOOP
        digits := regexp_replace(COALESCE(segment, ''), '\D', '', 'g');
        IF digits <> '' AND NOT ('act_' || digits = ANY(accounts)) THEN
          accounts := accounts || ('act_' || digits);
        END IF;
      END LOOP;
    END IF;

    IF COALESCE(array_length(accounts, 1), 0) = 0 THEN
      CONTINUE;
    END IF;

    -- Production repair rule for the known contaminated pair: keep the active account.
    IF 'act_4172099716404860' = ANY(accounts) AND 'act_9523446201036125' = ANY(accounts) THEN
      selected_account := 'act_4172099716404860';
    ELSE
      selected_account := accounts[1];
    END IF;

    selected_page := regexp_replace(COALESCE(rec.metadata->>'pageId', rec.metadata->>'page_id', ''), '\D', '', 'g');
    IF selected_page = '' AND selected_account = 'act_4172099716404860' THEN
      selected_page := '685010274687129';
    END IF;

    UPDATE public.integrations
    SET metadata = jsonb_strip_nulls(
          metadata
          || jsonb_build_object(
            'adAccountId', selected_account,
            'ad_account_id', selected_account,
            'adAccountIds', to_jsonb(accounts),
            'ad_account_ids', to_jsonb(accounts),
            'pageId', NULLIF(selected_page, ''),
            'page_id', NULLIF(selected_page, '')
          )
        ),
        updated_at = NOW()
    WHERE id = rec.id;
  END LOOP;
  -- Guarantee the integration upsert key is enforceable for every service.
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, service
        ORDER BY
          (status = 'connected') DESC,
          updated_at DESC NULLS LAST,
          id DESC
      ) AS rn
    FROM public.integrations
  )
  DELETE FROM public.integrations i
  USING ranked r
  WHERE i.id = r.id
    AND r.rn > 1;
END $$;

-- Remove cache records keyed with comma-joined account IDs so dashboards cannot
-- serve stale aggregate results generated from polluted scalar account IDs.
DELETE FROM public.meta_cache
WHERE id ~ 'act_[0-9]+,act_[0-9]+';

CREATE UNIQUE INDEX IF NOT EXISTS integrations_user_service_unique_idx
  ON public.integrations (user_id, service);
