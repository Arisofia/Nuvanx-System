-- =============================================================================
-- CI database hardening
--
-- Keeps fresh migration replays and production db push aligned after CI found
-- schema/order issues around schema-qualified extensions, dependent view drops,
-- and public EXECUTE defaults on the WhatsApp reconciliation RPC.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  ELSE
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  ELSE
    CREATE EXTENSION unaccent WITH SCHEMA extensions;
  END IF;
END $$;


ALTER FUNCTION public.reconcile_whatsapp_interactions_to_leads(UUID) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.reconcile_whatsapp_interactions_to_leads(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_whatsapp_interactions_to_leads(UUID) TO service_role;
