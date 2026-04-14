-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — ESQUEMA COMPLETO
-- Proyecto: ssvvuuysgxyqvmovrlvk.supabase.co
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared trigger function (advisor-friendly search_path)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Core backend tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255),
  password_hash TEXT NOT NULL,
  clinic_id     UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  service       VARCHAR(64) NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used     TIMESTAMPTZ,
  UNIQUE(user_id, service)
);

CREATE TABLE IF NOT EXISTS public.integrations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  service    VARCHAR(64) NOT NULL,
  status     VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  last_sync  TIMESTAMPTZ,
  last_error TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, service)
);

CREATE TABLE IF NOT EXISTS public.leads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       VARCHAR(255),
  email      VARCHAR(255),
  phone      VARCHAR(64),
  source     VARCHAR(64) NOT NULL DEFAULT 'manual',
  stage      VARCHAR(64) NOT NULL DEFAULT 'lead',
  revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      UUID,
  action        VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id   UUID,
  ip_address    INET,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credentials_user_id_idx ON public.credentials(user_id);
CREATE INDEX IF NOT EXISTS integrations_user_id_idx ON public.integrations(user_id);
CREATE INDEX IF NOT EXISTS leads_user_id_idx ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS leads_stage_idx ON public.leads(user_id, stage);
CREATE INDEX IF NOT EXISTS leads_source_idx ON public.leads(user_id, source);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON public.audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log(created_at DESC);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self_only ON public.users;
CREATE POLICY users_self_only ON public.users USING (TRUE);

DROP POLICY IF EXISTS credentials_owner_only ON public.credentials;
CREATE POLICY credentials_owner_only ON public.credentials USING (TRUE);

DROP POLICY IF EXISTS integrations_owner_only ON public.integrations;
CREATE POLICY integrations_owner_only ON public.integrations USING (TRUE);

DROP POLICY IF EXISTS leads_owner_only ON public.leads;
CREATE POLICY leads_owner_only ON public.leads USING (TRUE);

DROP POLICY IF EXISTS audit_log_insert_only ON public.audit_log;
DROP POLICY IF EXISTS audit_log_no_update ON public.audit_log;
DROP POLICY IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE POLICY audit_log_insert_only ON public.audit_log FOR INSERT WITH CHECK (TRUE);
CREATE POLICY audit_log_no_update ON public.audit_log FOR UPDATE USING (FALSE);
CREATE POLICY audit_log_no_delete ON public.audit_log FOR DELETE USING (FALSE);

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS integrations_updated_at ON public.integrations;
CREATE TRIGGER integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Frontend/Supabase state tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_integrations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  service    VARCHAR(64) NOT NULL,
  status     VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  last_sync  TIMESTAMPTZ,
  last_error TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, service)
);

CREATE TABLE IF NOT EXISTS public.user_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  service       VARCHAR(64) NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used     TIMESTAMPTZ,
  UNIQUE(user_id, service)
);

CREATE INDEX IF NOT EXISTS user_integrations_user_id_idx ON public.user_integrations(user_id);
CREATE INDEX IF NOT EXISTS user_credentials_user_id_idx ON public.user_credentials(user_id);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_integrations_owner ON public.user_integrations;
CREATE POLICY user_integrations_owner ON public.user_integrations
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS user_credentials_owner ON public.user_credentials;
CREATE POLICY user_credentials_owner ON public.user_credentials
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP TRIGGER IF EXISTS user_integrations_updated_at ON public.user_integrations;
CREATE TRIGGER user_integrations_updated_at
  BEFORE UPDATE ON public.user_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Monitoring schema
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS monitoring;

CREATE TABLE IF NOT EXISTS monitoring.operational_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  message    TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring.commands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  command_type VARCHAR(64) NOT NULL,
  status       VARCHAR(32) NOT NULL DEFAULT 'pending',
  payload      JSONB NOT NULL DEFAULT '{}',
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operational_events_user_id_idx ON monitoring.operational_events(user_id);
CREATE INDEX IF NOT EXISTS operational_events_created_at_idx ON monitoring.operational_events(created_at DESC);
CREATE INDEX IF NOT EXISTS commands_user_id_idx ON monitoring.commands(user_id);
CREATE INDEX IF NOT EXISTS commands_status_idx ON monitoring.commands(status);

ALTER TABLE monitoring.operational_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring.commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_events ON monitoring.operational_events;
CREATE POLICY authenticated_read_events ON monitoring.operational_events
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS service_role_full_access_events ON monitoring.operational_events;
CREATE POLICY service_role_full_access_events ON monitoring.operational_events
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS authenticated_read_commands ON monitoring.commands;
CREATE POLICY authenticated_read_commands ON monitoring.commands
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS service_role_full_access_commands ON monitoring.commands;
CREATE POLICY service_role_full_access_commands ON monitoring.commands
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP TRIGGER IF EXISTS commands_updated_at ON monitoring.commands;
CREATE TRIGGER commands_updated_at
  BEFORE UPDATE ON monitoring.commands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- KPI tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kpi_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  target_value NUMERIC(12,2),
  unit         VARCHAR(32),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.kpi_values (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id      UUID NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  value       NUMERIC(12,2) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_definitions_read_all ON public.kpi_definitions;
CREATE POLICY kpi_definitions_read_all ON public.kpi_definitions
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS kpi_values_owner_only ON public.kpi_values;
CREATE POLICY kpi_values_owner_only ON public.kpi_values
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Verification query (expected 11 rows, all rowsecurity=true)
-- -----------------------------------------------------------------------------
SELECT n.nspname AS schemaname, c.relname AS tablename, c.relrowsecurity AS rowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND (
    (n.nspname = 'monitoring' AND c.relname IN ('commands', 'operational_events'))
    OR (n.nspname = 'public' AND c.relname IN (
      'audit_log', 'credentials', 'integrations', 'kpi_definitions', 'kpi_values',
      'leads', 'user_credentials', 'user_integrations', 'users'
    ))
  )
ORDER BY n.nspname, c.relname;