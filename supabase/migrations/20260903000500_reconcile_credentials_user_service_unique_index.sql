-- Forward-only reconciliation for the canonical credentials upsert contract.
--
-- Production already has credentials_user_id_service_key on
-- public.credentials(user_id, service), but clean replay does not currently
-- recreate that invariant. Google Ads runtime-owned provisioning relies on
-- ON CONFLICT (user_id, service), so keep the migration history deterministic
-- without modifying any previously applied migration.
--
-- Provisioning must also commit the credential replacement and the matching
-- integration connected-state update atomically. The RPC below executes both
-- writes inside the same PostgreSQL transaction and is executable only by the
-- service_role used by the Edge runtime.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS credentials_user_id_service_key
  ON public.credentials (user_id, service);

CREATE OR REPLACE FUNCTION public.nvx_commit_google_ads_credential_provision(
  p_integration_id UUID,
  p_encrypted_key TEXT,
  p_committed_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_integration public.integrations%ROWTYPE;
  v_credential_id UUID;
  v_committed_at TIMESTAMPTZ := COALESCE(p_committed_at, NOW());
BEGIN
  IF p_integration_id IS NULL THEN
    RAISE EXCEPTION 'Google Ads integration id is required';
  END IF;

  IF NULLIF(BTRIM(p_encrypted_key), '') IS NULL THEN
    RAISE EXCEPTION 'Google Ads encrypted credential is required';
  END IF;

  SELECT *
  INTO v_integration
  FROM public.integrations
  WHERE id = p_integration_id
    AND service = 'google_ads'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Google Ads integration not found';
  END IF;

  INSERT INTO public.credentials (
    user_id,
    clinic_id,
    service,
    encrypted_key,
    last_used,
    metadata
  )
  VALUES (
    v_integration.user_id,
    v_integration.clinic_id,
    'google_ads',
    p_encrypted_key,
    v_committed_at,
    jsonb_build_object(
      'credential_format', 'aes_gcm_pbkdf2_sha256_v1',
      'provisioned_at', v_committed_at,
      'provisioned_by', 'google_ads_health_runtime'
    )
  )
  ON CONFLICT (user_id, service)
  DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    encrypted_key = EXCLUDED.encrypted_key,
    last_used = EXCLUDED.last_used,
    metadata = EXCLUDED.metadata
  RETURNING id INTO v_credential_id;

  UPDATE public.integrations
  SET status = 'connected',
      last_sync = v_committed_at,
      last_error = NULL,
      updated_at = v_committed_at
  WHERE id = v_integration.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Google Ads integration persistence failed';
  END IF;

  RETURN v_credential_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_commit_google_ads_credential_provision(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_commit_google_ads_credential_provision(UUID, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.nvx_commit_google_ads_credential_provision(UUID, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_commit_google_ads_credential_provision(UUID, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
