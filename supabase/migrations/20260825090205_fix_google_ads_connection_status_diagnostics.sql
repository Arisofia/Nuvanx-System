-- Preserve the canonical Google Ads status surface while diagnosing partial states.
-- This follow-up migration intentionally does not rewrite the already-applied
-- 20260825082322 baseline migration.

create or replace view public.vw_google_ads_connection_status
with (security_invoker = true)
as
with google_ads_users as (
  select user_id from public.integrations where service = 'google_ads'
  union
  select user_id from public.credentials where service = 'google_ads'
)
select
  u.user_id,
  coalesce(i.clinic_id, c.clinic_id) as clinic_id,
  i.id as integration_id,
  coalesce(i.status, 'credential_only'::character varying(32))::character varying(32) as status,
  nullif(btrim(coalesce(
    i.metadata->>'customerId',
    i.metadata->>'customer_id',
    c.metadata->>'customerId',
    c.metadata->>'customer_id',
    ''
  )), '') as customer_id,
  (c.id is not null) as credential_present,
  c.created_at as credential_created_at,
  c.last_used as credential_last_used,
  i.last_sync,
  i.last_error,
  coalesce(i.updated_at, c.created_at) as updated_at
from google_ads_users u
left join public.integrations i
  on i.user_id = u.user_id
 and i.service = 'google_ads'
left join public.credentials c
  on c.user_id = u.user_id
 and c.service = 'google_ads';

revoke all on public.vw_google_ads_connection_status from public;
revoke all on public.vw_google_ads_connection_status from anon;
revoke all on public.vw_google_ads_connection_status from authenticated;
grant select on public.vw_google_ads_connection_status to service_role;

comment on view public.vw_google_ads_connection_status is
  'Secret-free Google Ads integration/credential status for authenticated server-side API output, including partial credential-only states.';
