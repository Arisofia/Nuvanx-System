-- Atomic one-shot provisioning for the canonical NUVANX Meta Ads credential.
-- The encrypted credential is produced outside PostgreSQL using the existing
-- PBKDF2-SHA256 / AES-256-GCM envelope and is never returned by this function.

create or replace function public.provision_meta_ads_credential_once(
  p_user_id uuid,
  p_clinic_id uuid,
  p_integration_id uuid,
  p_encrypted_key text,
  p_expected_app_id text,
  p_expected_business_id text,
  p_expected_ad_account_id text,
  p_expected_page_id text,
  p_expected_system_user_id text,
  p_expected_pixel_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.integrations%rowtype;
  v_credential_id uuid;
  v_now timestamptz := clock_timestamp();
  v_parts text[];
begin
  if p_user_id is null
     or p_clinic_id is null
     or p_integration_id is null
     or nullif(btrim(p_encrypted_key), '') is null
     or nullif(btrim(p_expected_app_id), '') is null
     or nullif(btrim(p_expected_business_id), '') is null
     or nullif(btrim(p_expected_ad_account_id), '') is null
     or nullif(btrim(p_expected_page_id), '') is null
     or nullif(btrim(p_expected_system_user_id), '') is null
     or nullif(btrim(p_expected_pixel_id), '') is null then
    raise exception 'canonical Meta credential provisioning parameters are incomplete';
  end if;

  v_parts := string_to_array(p_encrypted_key, ':');
  if coalesce(array_length(v_parts, 1), 0) <> 4
     or length(v_parts[1]) <> 64
     or length(v_parts[2]) <> 24
     or length(v_parts[3]) <> 32
     or length(v_parts[4]) < 2
     or mod(length(v_parts[4]), 2) <> 0
     or p_encrypted_key !~ '^[0-9a-f]{64}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$' then
    raise exception 'encrypted credential envelope is malformed';
  end if;

  select i.*
    into strict v_integration
    from public.integrations i
   where i.id = p_integration_id
     and i.user_id = p_user_id
     and i.service = 'meta_ads'
   for update;

  if v_integration.clinic_id is distinct from p_clinic_id then
    raise exception 'canonical Meta integration clinic mismatch';
  end if;

  if v_integration.status is distinct from 'disconnected' then
    raise exception 'canonical Meta integration must be disconnected before provisioning';
  end if;

  if coalesce(v_integration.metadata->>'credential_state', '') <> 'missing_management_token' then
    raise exception 'canonical Meta integration credential state is not provisionable';
  end if;

  if coalesce(v_integration.metadata->>'canonical', '') <> 'true' then
    raise exception 'canonical Meta integration flag is missing';
  end if;

  if coalesce(v_integration.metadata->>'appId', '') <> p_expected_app_id
     or coalesce(v_integration.metadata->>'app_id', '') <> p_expected_app_id
     or coalesce(v_integration.metadata->>'businessPortfolioId', '') <> p_expected_business_id
     or coalesce(v_integration.metadata->>'business_portfolio_id', '') <> p_expected_business_id
     or coalesce(v_integration.metadata->>'adAccountId', '') <> p_expected_ad_account_id
     or coalesce(v_integration.metadata->>'ad_account_id', '') <> p_expected_ad_account_id
     or coalesce(v_integration.metadata->>'pageId', '') <> p_expected_page_id
     or coalesce(v_integration.metadata->>'page_id', '') <> p_expected_page_id
     or coalesce(v_integration.metadata->>'systemUserId', '') <> p_expected_system_user_id
     or coalesce(v_integration.metadata->>'system_user_id', '') <> p_expected_system_user_id
     or coalesce(v_integration.metadata->>'pixelId', '') <> p_expected_pixel_id
     or coalesce(v_integration.metadata->>'pixel_id', '') <> p_expected_pixel_id then
    raise exception 'canonical Meta integration asset metadata mismatch';
  end if;

  if exists (
    select 1
      from public.credentials c
     where c.user_id = p_user_id
       and c.service = 'meta_ads'
  ) then
    raise exception using
      errcode = '23505',
      message = 'meta_ads credential already exists for target user';
  end if;

  insert into public.credentials (
    user_id,
    service,
    encrypted_key,
    clinic_id,
    metadata
  )
  values (
    p_user_id,
    'meta_ads',
    p_encrypted_key,
    p_clinic_id,
    jsonb_build_object(
      'clinic_id', p_clinic_id::text,
      'app_id', p_expected_app_id,
      'business_id', p_expected_business_id,
      'ad_account_id', p_expected_ad_account_id,
      'ad_account_ids', jsonb_build_array(p_expected_ad_account_id),
      'page_id', p_expected_page_id,
      'system_user_id', p_expected_system_user_id,
      'pixel_id', p_expected_pixel_id,
      'source', 'canonical_system_user_provision_2026-08-24'
    )
  )
  returning id into v_credential_id;

  update public.integrations
     set status = 'connected',
         last_error = null,
         metadata = coalesce(v_integration.metadata, '{}'::jsonb) || jsonb_build_object(
           'canonical', true,
           'credential_state', 'stored_management_token',
           'credential_service', 'meta_ads',
           'pixelId', p_expected_pixel_id,
           'pixel_id', p_expected_pixel_id,
           'source', 'canonical_system_user_provision_2026-08-24',
           'provisioned_at', v_now
         ),
         updated_at = v_now
   where id = p_integration_id
     and user_id = p_user_id
     and service = 'meta_ads';

  if not found then
    raise exception 'canonical Meta integration disappeared during provisioning';
  end if;

  return jsonb_build_object(
    'success', true,
    'credential_id', v_credential_id,
    'integration_id', p_integration_id,
    'service', 'meta_ads',
    'status', 'connected'
  );
end;
$$;

revoke all on function public.provision_meta_ads_credential_once(
  uuid, uuid, uuid, text, text, text, text, text, text, text
) from public;
revoke all on function public.provision_meta_ads_credential_once(
  uuid, uuid, uuid, text, text, text, text, text, text, text
) from anon;
revoke all on function public.provision_meta_ads_credential_once(
  uuid, uuid, uuid, text, text, text, text, text, text, text
) from authenticated;
grant execute on function public.provision_meta_ads_credential_once(
  uuid, uuid, uuid, text, text, text, text, text, text, text
) to service_role;

comment on function public.provision_meta_ads_credential_once(
  uuid, uuid, uuid, text, text, text, text, text, text, text
) is 'Atomically provisions the canonical per-user meta_ads encrypted credential after exact integration-state validation. Execute only with service_role.';
