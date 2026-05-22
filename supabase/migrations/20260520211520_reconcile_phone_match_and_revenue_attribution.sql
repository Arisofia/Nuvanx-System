-- reconcile_phone_match_and_revenue_attribution
UPDATE doctoralia_patients dp
SET lead_id = l.id,
    match_confidence = GREATEST(COALESCE(dp.match_confidence, 0), 0.85),
    match_class = COALESCE(dp.match_class, 'phone_match_auto')
FROM leads l
WHERE dp.lead_id IS NULL
  AND l.deleted_at IS NULL
  AND l.phone_normalized IS NOT NULL
  AND dp.phone_normalized IS NOT NULL
  AND dp.phone_normalized = l.phone_normalized;

ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id);
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS audit_note TEXT;

UPDATE financial_settlements fs
SET lead_id = l.id
FROM leads l
WHERE fs.lead_id IS NULL
  AND fs.cancelled_at IS NULL
  AND fs.phone_normalized IS NOT NULL
  AND l.deleted_at IS NULL
  AND l.phone_normalized IS NOT NULL
  AND fs.phone_normalized = l.phone_normalized;

UPDATE leads l
SET verified_revenue = sub.total_revenue
FROM (
  SELECT lead_id, ROUND(SUM(amount_net)::numeric, 2) AS total_revenue
  FROM financial_settlements
  WHERE lead_id IS NOT NULL AND cancelled_at IS NULL
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id AND l.deleted_at IS NULL;
