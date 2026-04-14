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

-- ---------------------------------------------------------------------------
-- MONITORING & OPERATIONAL COMMANDS (Addresses Supabase Advisor Warnings)
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS monitoring;

-- Table: monitoring.operational_events
CREATE TABLE IF NOT EXISTS monitoring.operational_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL,
  event_type  VARCHAR(64)  NOT NULL,
  message     TEXT         NOT NULL,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE monitoring.operational_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read_events ON monitoring.operational_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY service_role_full_access_events ON monitoring.operational_events
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Table: monitoring.commands
CREATE TABLE IF NOT EXISTS monitoring.commands (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL,
  command_type  VARCHAR(64)  NOT NULL,
  status        VARCHAR(32)  NOT NULL DEFAULT 'pending',
  payload       JSONB        NOT NULL DEFAULT '{}',
  result        JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE monitoring.commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read_commands ON monitoring.commands
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY service_role_full_access_commands ON monitoring.commands
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE TRIGGER commands_updated_at
  BEFORE UPDATE ON monitoring.commands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- KPI DEFINITIONS & VALUES (Addresses Security Definer View issue)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kpi_definitions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  target_value NUMERIC(12,2),
  unit         VARCHAR(32),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY kpi_definitions_read_all ON kpi_definitions
  FOR SELECT TO authenticated USING (TRUE);

CREATE TABLE IF NOT EXISTS kpi_values (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id       UUID          NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  user_id      UUID          NOT NULL,
  value        NUMERIC(12,2) NOT NULL,
  captured_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE kpi_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY kpi_values_owner_only ON kpi_values
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
