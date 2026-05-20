-- cancel_duplicate_settlements_and_add_audit_col
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS audit_note TEXT;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY phone_normalized, settled_at::date ORDER BY id
    ) AS rn
  FROM financial_settlements
  WHERE cancelled_at IS NULL AND phone_normalized IS NOT NULL
),
duplicados AS (SELECT id FROM ranked WHERE rn > 1)
UPDATE financial_settlements
SET cancelled_at = NOW(),
    audit_note = '[AUTO-CANCELLED: duplicate phone+date — audit 2026-05-19]'
WHERE id IN (SELECT id FROM duplicados);
