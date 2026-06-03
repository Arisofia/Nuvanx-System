-- =============================================================================
-- Harden public.handle_updated_at trigger helper.
--
-- This function is intended only for internal trigger execution, not as a
-- public RPC endpoint. We switch it to SECURITY INVOKER and remove public
-- execute permissions so anon/authenticated cannot call it via /rest/v1/rpc.
-- =============================================================================

-- Note: wrapped in DO for conditional apply; use distinct dollar-quoting to avoid
-- parser ambiguity with nested BEGIN / AS $$ inside plpgsql DO blocks.
DO $$
BEGIN
  IF to_regprocedure('public.handle_updated_at()') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.handle_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_catalog
    AS $func$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $func$;

    REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC;

    COMMENT ON FUNCTION public.handle_updated_at() IS
      'Trigger function for updated_at maintenance. Hardened 2026-06-06: SECURITY INVOKER + revoke PUBLIC execute to prevent public RPC access.';
  END IF;
END $$;
