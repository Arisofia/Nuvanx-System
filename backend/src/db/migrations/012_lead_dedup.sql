-- =============================================================================
-- 012: Lead deduplication — partial UNIQUE on phone and email
-- Prevents duplicate leads for the same user when phone or email match.
-- Partial indexes exclude NULLs so leads without phone/email aren't blocked.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_phone_uq
  ON leads (user_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_email_uq
  ON leads (user_id, email)
  WHERE email IS NOT NULL AND email <> '';
