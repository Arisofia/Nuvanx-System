-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — Monitoring & KPIs Schema
-- =============================================================================

-- Create monitoring schema
CREATE SCHEMA IF NOT EXISTS monitoring;

-- ---------------------------------------------------------------------------
-- Table: monitoring.operational_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitoring.operational_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL,
  event_type  VARCHAR(64)  NOT NULL,
  message     TEXT         NOT NULL,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operational_events_user_id_idx ON monitoring.operational_events(user_id);
CREATE INDEX IF NOT EXISTS operational_events_created_at_idx ON monitoring.operational_events(created_at DESC);

-- Enable RLS (Fixes Advisor "RLS Disabled" warning)
ALTER TABLE monitoring.operational_events ENABLE ROW LEVEL SECURITY;

-- Policies (Addressing Advisor "Policy Exists RLS Disabled" issues)
CREATE POLICY authenticated_read_events ON monitoring.operational_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY service_role_full_access_events ON monitoring.operational_events
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- Table: monitoring.commands
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS commands_user_id_idx ON monitoring.commands(user_id);
CREATE INDEX IF NOT EXISTS commands_status_idx ON monitoring.commands(status);

-- Enable RLS (Fixes Advisor "RLS Disabled" warning)
ALTER TABLE monitoring.commands ENABLE ROW LEVEL SECURITY;

-- Policies (Addressing Advisor "Policy Exists RLS Disabled" issues)
CREATE POLICY authenticated_read_commands ON monitoring.commands
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY service_role_full_access_commands ON monitoring.commands
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Trigger for auto-updating updated_at
CREATE TRIGGER commands_updated_at
  BEFORE UPDATE ON monitoring.commands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- KPI Definitions & Values (Addressing Security Definer View issues)
-- ---------------------------------------------------------------------------

-- We implement these as tables first. If the user had them as views, 
-- they should be converted to tables or views with SECURITY INVOKER.
CREATE TABLE IF NOT EXISTS kpi_definitions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  target_value NUMERIC(12,2),
  unit         VARCHAR(32),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_values (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id       UUID          NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  user_id      UUID          NOT NULL,
  value        NUMERIC(12,2) NOT NULL,
  captured_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_values ENABLE ROW LEVEL SECURITY;

-- Basic policies for KPI tables
ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY kpi_definitions_read_all ON kpi_definitions
  FOR SELECT TO authenticated USING (TRUE);

ALTER TABLE public.kpi_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY kpi_values_owner_only ON kpi_values
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Note: To fix "Security Definer View" warning, if you decide to use views,
-- always define them with SECURITY INVOKER (default in PostgreSQL 15+).
