-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — Initial Schema
-- Run against Supabase PostgreSQL (or any PostgreSQL >= 14).
--
-- RLS model (two-tier):
--   Service role (DATABASE_URL / backend): bypasses RLS entirely; Node backend
--     enforces user isolation at the query layer (WHERE user_id = $1).
--   Authenticated role (Supabase JS client / browser): scoped by auth.uid().
--
-- Policy matrix:
--   users        — SELECT + UPDATE for authenticated (auth.uid() = id)
--                  INSERT via service role only (backend /register route)
--   credentials  — no authenticated-role policies; encrypted keys are never
--                  accessible from the browser
--   integrations — SELECT for authenticated (auth.uid() = user_id);
--                  INSERT/UPDATE/DELETE via service role only
--   leads        — no authenticated-role policies; PII served via API only
--   audit_log    — INSERT only (append-only); UPDATE/DELETE blocked for all
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

-- Authenticated users can read/update their own row.
-- INSERT is handled by the backend service role only (/register route).
CREATE POLICY "users_select_own" ON users
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

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

-- No authenticated-role policies: encrypted keys must never be reachable from
-- the browser. The backend service role bypasses RLS and enforces user
-- isolation via WHERE user_id = $1 in every query.

-- ---------------------------------------------------------------------------
-- Table: integrations
-- Tracks connection state per user per service.  The actual credential is in
-- the credentials table.  metadata is a JSONB bag for service-specific data
-- (e.g. Meta ad account ID).
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

-- Authenticated users can read their own integration status (used for status
-- display in the browser). INSERT/UPDATE/DELETE are backend service-role only.
CREATE POLICY "integrations_select_own" ON integrations
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

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

-- No authenticated-role policies: leads contain PII (name, email, phone) and
-- must be served via the backend API only, never directly from the browser.
-- The backend service role bypasses RLS and enforces user isolation via WHERE.

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
