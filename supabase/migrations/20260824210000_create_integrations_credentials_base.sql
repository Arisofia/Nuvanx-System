-- Base schema required by the canonical Meta credential provisioner that follows.
-- This migration creates only durable schema objects. The later canonical bootstrap
-- remains responsible for indexes, RLS, grants and policy reconciliation.

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
