-- =============================================================================
-- Supabase migration: Lead dedup — partial UNIQUE on phone and email
-- Mirrors backend/src/db/migrations/012_lead_dedup.sql
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_phone_uq
  ON leads (user_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_email_uq
  ON leads (user_id, email)
  WHERE email IS NOT NULL AND email <> '';
