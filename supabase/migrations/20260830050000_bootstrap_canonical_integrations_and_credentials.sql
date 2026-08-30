-- #355: Canonical bootstrap migration for integrations and credentials tables.
--
-- Ensures a fresh, clean database rebuild from migrations contains the full,
-- production-grade schema for public.integrations and public.credentials,
-- including constraints, indexes, RLS, and permissions, without relying
-- on manual objects created out-of-band.

-- 1. Table: public.integrations
CREATE TABLE IF NOT EXISTS public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_sync TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  webhook_token TEXT,
  webhook_url TEXT,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL
);

-- Ensure all columns exist idempotently
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL,
  ADD COLUMN IF NOT EXISTS service TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS last_sync TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS webhook_token TEXT,
  ADD COLUMN IF NOT EXISTS webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL;

-- Canonical unique index for user + service
CREATE UNIQUE INDEX IF NOT EXISTS integrations_user_service_uq
  ON public.integrations (user_id, service);

-- Supporting indexes
CREATE INDEX IF NOT EXISTS idx_integrations_clinic_id
  ON public.integrations (clinic_id)
  WHERE clinic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integrations_service_status
  ON public.integrations (service, status);

-- 2. Table: public.credentials
CREATE TABLE IF NOT EXISTS public.credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  service TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used TIMESTAMPTZ,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Ensure all columns exist idempotently
ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL,
  ADD COLUMN IF NOT EXISTS service TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS encrypted_key TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_used TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Supporting indexes
CREATE INDEX IF NOT EXISTS idx_credentials_clinic_id
  ON public.credentials (clinic_id)
  WHERE clinic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_user_service
  ON public.credentials (user_id, service);

-- 3. Row Level Security & Access Control
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT ALL ON TABLE public.integrations TO service_role;
GRANT ALL ON TABLE public.credentials TO service_role;

GRANT SELECT ON TABLE public.integrations TO authenticated;
GRANT SELECT ON TABLE public.credentials TO authenticated;

-- Policies: service_role full access
DROP POLICY IF EXISTS integrations_service_role_all ON public.integrations;
CREATE POLICY integrations_service_role_all
  ON public.integrations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS credentials_service_role_all ON public.credentials;
CREATE POLICY credentials_service_role_all
  ON public.credentials
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Policies: authenticated clinic / user scoped access
DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
CREATE POLICY integrations_select_clinic
  ON public.integrations
  FOR SELECT TO authenticated
  USING (
    ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true')
    AND (
      user_id = auth.uid()
      OR (clinic_id IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()))
    )
  );

DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
CREATE POLICY credentials_select_clinic
  ON public.credentials
  FOR SELECT TO authenticated
  USING (
    ((SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true')
    AND (
      user_id = auth.uid()
      OR (clinic_id IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()))
    )
  );
