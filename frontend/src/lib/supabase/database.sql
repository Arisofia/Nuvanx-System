-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — Supabase Schema
-- =============================================================================
-- Instructions:
--   1. Open your Supabase project → SQL Editor → New query
--   2. Paste ALL of this file's contents
--   3. Click "Run" — you should see "Success. No rows returned"
--   4. Go to Table Editor to verify both tables were created
--
-- See SUPABASE_SETUP.md for the full setup guide.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Table: user_integrations
-- Stores the connection state for each integration per user.
-- The actual credential (API key) lives in user_credentials.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_integrations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  service    VARCHAR(64) NOT NULL,
  status     VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  last_sync  TIMESTAMPTZ,
  last_error TEXT,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, service)
);

CREATE INDEX IF NOT EXISTS user_integrations_user_id_idx ON user_integrations(user_id);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own integrations
CREATE POLICY user_integrations_owner ON user_integrations
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Table: user_credentials
-- Stores AES-256-GCM encrypted API credentials per user per service.
-- The raw credential is NEVER stored in plaintext.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_credentials (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL,
  service        VARCHAR(64) NOT NULL,
  encrypted_key  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used      TIMESTAMPTZ,
  UNIQUE(user_id, service)
);

CREATE INDEX IF NOT EXISTS user_credentials_user_id_idx ON user_credentials(user_id);

ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;

-- Users can only access their own credentials
CREATE POLICY user_credentials_owner ON user_credentials
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on user_integrations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_integrations_updated_at
  BEFORE UPDATE ON user_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
