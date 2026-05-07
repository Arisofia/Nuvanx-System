-- =============================================================================
-- Dedup leads by clinic_id (soft delete) + scope insights tables to clinic_id.
--
-- Decisions (approved by user):
--   - Keeper rule: oldest user in the clinic (MIN(users.created_at)).
--   - Delete mode for leads: SOFT — adds merged_into_lead_id + deleted_at.
--   - Delete mode for derivative tables (meta_daily_insights, meta_organic_insights,
--     meta_ig_insights): HARD — these are reproducible from the Meta Graph API.
--   - KPI scope: clinic_id. New unique indexes enforce uniqueness at clinic scope.
--
-- Rollback strategy:
--   - For leads, run:
--       UPDATE leads SET deleted_at = NULL, merged_into_lead_id = NULL
--       WHERE deleted_at >= '<migration_run_ts>';
--     and re-create the old user-scoped indexes from prior migrations.
--   - For insights tables, hard-deleted rows can be re-fetched via
--       POST /meta/backfill?days=N
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Safety: ensure clinic_id is populated on leads (idempotent backfill).
-- ---------------------------------------------------------------------------
UPDATE leads SET clinic_id = u.clinic_id
FROM users u
WHERE leads.user_id = u.id
  AND leads.clinic_id IS NULL
  AND u.clinic_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Soft-delete columns on leads.
-- ---------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS merged_into_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_merged_into_idx ON leads(merged_into_lead_id)
  WHERE merged_into_lead_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Determine the keeper user per clinic (oldest by users.created_at).
--    Used as the canonical user_id for any cross-user merges.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE clinic_keepers ON COMMIT DROP AS
SELECT DISTINCT ON (clinic_id)
  clinic_id,
  id AS keeper_user_id
FROM users
WHERE clinic_id IS NOT NULL
ORDER BY clinic_id, created_at ASC, id ASC;

-- ---------------------------------------------------------------------------
-- 3. Soft-merge leads duplicated by (clinic_id, source, external_id).
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    clinic_id,
    source,
    external_id,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id, source, external_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY clinic_id, source, external_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS keeper_id
  FROM leads
  WHERE clinic_id IS NOT NULL
    AND external_id IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE leads l
SET merged_into_lead_id = r.keeper_id,
    deleted_at = NOW()
FROM ranked r
WHERE l.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- 4. Soft-merge leads duplicated by (clinic_id, phone) — only on rows that
--    are still active and where phone is non-empty. external_id duplicates
--    are already handled in step 3.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id, phone
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY clinic_id, phone
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS keeper_id
  FROM leads
  WHERE clinic_id IS NOT NULL
    AND phone IS NOT NULL AND phone <> ''
    AND deleted_at IS NULL
)
UPDATE leads l
SET merged_into_lead_id = COALESCE(l.merged_into_lead_id, r.keeper_id),
    deleted_at = NOW()
FROM ranked r
WHERE l.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- 5. Soft-merge leads duplicated by (clinic_id, email).
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id, email
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY clinic_id, email
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS keeper_id
  FROM leads
  WHERE clinic_id IS NOT NULL
    AND email IS NOT NULL AND email <> ''
    AND deleted_at IS NULL
)
UPDATE leads l
SET merged_into_lead_id = COALESCE(l.merged_into_lead_id, r.keeper_id),
    deleted_at = NOW()
FROM ranked r
WHERE l.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- 6. Drop legacy user-scoped unique indexes.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS leads_user_source_external_id_uq;
DROP INDEX IF EXISTS leads_user_phone_uq;
DROP INDEX IF EXISTS leads_user_email_uq;

-- ---------------------------------------------------------------------------
-- 7. Create clinic-scoped partial unique indexes (active rows only).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS leads_clinic_source_external_id_uq
  ON leads (clinic_id, source, external_id)
  WHERE clinic_id IS NOT NULL
    AND external_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_clinic_phone_uq
  ON leads (clinic_id, phone)
  WHERE clinic_id IS NOT NULL
    AND phone IS NOT NULL AND phone <> ''
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_clinic_email_uq
  ON leads (clinic_id, email)
  WHERE clinic_id IS NOT NULL
    AND email IS NOT NULL AND email <> ''
    AND deleted_at IS NULL;

-- Hot-path index for clinic-scoped reads filtering out merged rows.
CREATE INDEX IF NOT EXISTS leads_clinic_active_idx
  ON leads (clinic_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8. meta_daily_insights → add clinic_id, dedup, swap PK to clinic-scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE meta_daily_insights
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;

UPDATE meta_daily_insights mdi
SET clinic_id = u.clinic_id
FROM users u
WHERE mdi.user_id = u.id
  AND mdi.clinic_id IS NULL
  AND u.clinic_id IS NOT NULL;

-- Hard-delete duplicate rows: keep the row owned by the clinic keeper user.
DELETE FROM meta_daily_insights mdi
USING clinic_keepers k
WHERE mdi.clinic_id = k.clinic_id
  AND mdi.user_id <> k.keeper_user_id;

-- Drop legacy PK and replace with clinic-scoped PK.
ALTER TABLE meta_daily_insights
  DROP CONSTRAINT IF EXISTS meta_daily_insights_pkey;

-- For rows still without a clinic_id (orphans), keep them but excluded from
-- the new PK by deleting them — they cannot be queried under the new model.
DELETE FROM meta_daily_insights WHERE clinic_id IS NULL;

ALTER TABLE meta_daily_insights
  ALTER COLUMN clinic_id SET NOT NULL,
  ADD CONSTRAINT meta_daily_insights_pkey PRIMARY KEY (clinic_id, ad_account_id, date);

CREATE INDEX IF NOT EXISTS meta_daily_insights_clinic_date_idx
  ON meta_daily_insights (clinic_id, date DESC);

-- ---------------------------------------------------------------------------
-- 9. meta_organic_insights → same treatment if the table exists.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'meta_organic_insights') THEN
    EXECUTE 'ALTER TABLE meta_organic_insights ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE';
    EXECUTE 'UPDATE meta_organic_insights mo SET clinic_id = u.clinic_id FROM users u WHERE mo.user_id = u.id AND mo.clinic_id IS NULL AND u.clinic_id IS NOT NULL';
    EXECUTE 'DELETE FROM meta_organic_insights mo USING clinic_keepers k WHERE mo.clinic_id = k.clinic_id AND mo.user_id <> k.keeper_user_id';
    EXECUTE 'DELETE FROM meta_organic_insights WHERE clinic_id IS NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS meta_organic_insights_clinic_idx ON meta_organic_insights (clinic_id)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. meta_ig_insights → same treatment if the table exists.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'meta_ig_insights') THEN
    EXECUTE 'ALTER TABLE meta_ig_insights ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE';
    EXECUTE 'UPDATE meta_ig_insights mi SET clinic_id = u.clinic_id FROM users u WHERE mi.user_id = u.id AND mi.clinic_id IS NULL AND u.clinic_id IS NOT NULL';
    EXECUTE 'DELETE FROM meta_ig_insights mi USING clinic_keepers k WHERE mi.clinic_id = k.clinic_id AND mi.user_id <> k.keeper_user_id';
    EXECUTE 'DELETE FROM meta_ig_insights WHERE clinic_id IS NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS meta_ig_insights_clinic_idx ON meta_ig_insights (clinic_id)';
  END IF;
END $$;

COMMIT;
