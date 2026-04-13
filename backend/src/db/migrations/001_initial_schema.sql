-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — Initial Schema
-- Run against Supabase PostgreSQL (or any PostgreSQL >= 14).
--
-- Row Level Security (RLS) is enabled on every table.  The application uses the
-- service-role key so RLS policies that depend on auth.uid() are enforced at
-- the database layer in addition to the application-layer JWT checks.
--
-- IMPORTANT: Enable the pgcrypto extension first:
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Table: users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) NOT NULL UNIQUE,
  name         VARCHAR(255),
  password_hash TEXT        NOT NULL,
  clinic_id    UUID,                         -- FK added in a later migration
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_only ON users
  USING (id = current_setting('app.user_id', TRUE)::UUID);

-- ---------------------------------------------------------------------------
-- Table: credentials
-- Stores AES-256-GCM encrypted API keys.  The raw key is NEVER stored here;
-- only the ciphertext produced by src/services/encryption.js.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credentials (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service        VARCHAR(64) NOT NULL,
  encrypted_key  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used      TIMESTAMPTZ,
  UNIQUE(user_id, service)
);

CREATE INDEX IF NOT EXISTS credentials_user_id_idx ON credentials(user_id);

ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY credentials_owner_only ON credentials
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

-- ---------------------------------------------------------------------------
-- Table: integrations
-- Tracks connection state per user per service.  The actual credential is in
-- the credentials table.  metadata is a JSONB bag for service-specific data
-- (e.g. Meta ad account ID, HubSpot portal ID).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service    VARCHAR(64) NOT NULL,
  status     VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  last_sync  TIMESTAMPTZ,
  last_error TEXT,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, service)
);

CREATE INDEX IF NOT EXISTS integrations_user_id_idx ON integrations(user_id);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY integrations_owner_only ON integrations
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

-- ---------------------------------------------------------------------------
-- Table: leads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(255),
  email      VARCHAR(255),
  phone      VARCHAR(64),
  source     VARCHAR(64)   NOT NULL DEFAULT 'manual',
  stage      VARCHAR(64)   NOT NULL DEFAULT 'lead',
  revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_user_id_idx  ON leads(user_id);
CREATE INDEX IF NOT EXISTS leads_stage_idx    ON leads(user_id, stage);
CREATE INDEX IF NOT EXISTS leads_source_idx   ON leads(user_id, source);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_owner_only ON leads
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

-- ---------------------------------------------------------------------------
-- Table: audit_log
-- Append-only record of every sensitive operation.  Required for GDPR/HIPAA.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL    PRIMARY KEY,
  actor_id      UUID,
  action        VARCHAR(64)  NOT NULL,
  resource_type VARCHAR(64)  NOT NULL,
  resource_id   UUID,
  ip_address    INET,
  metadata      JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx    ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx  ON audit_log(created_at DESC);

-- Audit log is append-only: no UPDATE or DELETE allowed
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_insert_only ON audit_log FOR INSERT WITH CHECK (TRUE);
CREATE POLICY audit_log_no_update   ON audit_log FOR UPDATE USING (FALSE);
CREATE POLICY audit_log_no_delete   ON audit_log FOR DELETE USING (FALSE);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
