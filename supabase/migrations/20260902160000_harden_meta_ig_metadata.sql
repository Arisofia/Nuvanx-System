-- Enforce the persisted Meta Instagram ID contract at the database boundary.
--
-- Instagram is optional for a Meta Ads integration. When either canonical
-- metadata key is populated, however, it must be a JSON string containing only
-- digits. If both aliases are populated they must agree. This prevents malformed
-- JSON (for example a numeric JSON value) from reaching Edge API PostgREST
-- filters despite TypeScript-only annotations.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.integrations AS i
    WHERE i.service = 'meta_ads'
      AND (
        (
          COALESCE(i.metadata, '{}'::jsonb) ? 'igBusinessAccountId'
          AND COALESCE(i.metadata, '{}'::jsonb)->'igBusinessAccountId' <> 'null'::jsonb
          AND NOT (
            jsonb_typeof(COALESCE(i.metadata, '{}'::jsonb)->'igBusinessAccountId') = 'string'
            AND (
              COALESCE(i.metadata, '{}'::jsonb)->>'igBusinessAccountId' = ''
              OR COALESCE(i.metadata, '{}'::jsonb)->>'igBusinessAccountId' ~ '^[0-9]+$'
            )
          )
        )
        OR (
          COALESCE(i.metadata, '{}'::jsonb) ? 'ig_business_account_id'
          AND COALESCE(i.metadata, '{}'::jsonb)->'ig_business_account_id' <> 'null'::jsonb
          AND NOT (
            jsonb_typeof(COALESCE(i.metadata, '{}'::jsonb)->'ig_business_account_id') = 'string'
            AND (
              COALESCE(i.metadata, '{}'::jsonb)->>'ig_business_account_id' = ''
              OR COALESCE(i.metadata, '{}'::jsonb)->>'ig_business_account_id' ~ '^[0-9]+$'
            )
          )
        )
        OR (
          NULLIF(COALESCE(i.metadata, '{}'::jsonb)->>'igBusinessAccountId', '') IS NOT NULL
          AND NULLIF(COALESCE(i.metadata, '{}'::jsonb)->>'ig_business_account_id', '') IS NOT NULL
          AND COALESCE(i.metadata, '{}'::jsonb)->>'igBusinessAccountId'
              <> COALESCE(i.metadata, '{}'::jsonb)->>'ig_business_account_id'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce integrations_meta_ig_id_contract: invalid Meta Instagram metadata exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.integrations'::regclass
      AND conname = 'integrations_meta_ig_id_contract'
  ) THEN
    ALTER TABLE public.integrations
      ADD CONSTRAINT integrations_meta_ig_id_contract
      CHECK (
        service <> 'meta_ads'
        OR (
          (
            NOT (COALESCE(metadata, '{}'::jsonb) ? 'igBusinessAccountId')
            OR COALESCE(metadata, '{}'::jsonb)->'igBusinessAccountId' = 'null'::jsonb
            OR (
              jsonb_typeof(COALESCE(metadata, '{}'::jsonb)->'igBusinessAccountId') = 'string'
              AND (
                COALESCE(metadata, '{}'::jsonb)->>'igBusinessAccountId' = ''
                OR COALESCE(metadata, '{}'::jsonb)->>'igBusinessAccountId' ~ '^[0-9]+$'
              )
            )
          )
          AND (
            NOT (COALESCE(metadata, '{}'::jsonb) ? 'ig_business_account_id')
            OR COALESCE(metadata, '{}'::jsonb)->'ig_business_account_id' = 'null'::jsonb
            OR (
              jsonb_typeof(COALESCE(metadata, '{}'::jsonb)->'ig_business_account_id') = 'string'
              AND (
                COALESCE(metadata, '{}'::jsonb)->>'ig_business_account_id' = ''
                OR COALESCE(metadata, '{}'::jsonb)->>'ig_business_account_id' ~ '^[0-9]+$'
              )
            )
          )
          AND (
            NULLIF(COALESCE(metadata, '{}'::jsonb)->>'igBusinessAccountId', '') IS NULL
            OR NULLIF(COALESCE(metadata, '{}'::jsonb)->>'ig_business_account_id', '') IS NULL
            OR COALESCE(metadata, '{}'::jsonb)->>'igBusinessAccountId'
               = COALESCE(metadata, '{}'::jsonb)->>'ig_business_account_id'
          )
        )
      ) NOT VALID;
  END IF;

  ALTER TABLE public.integrations
    VALIDATE CONSTRAINT integrations_meta_ig_id_contract;
END
$$;
COMMIT;

