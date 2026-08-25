-- Canonical, secret-free Google Ads connection status surface.
-- This view is consumed only through the authenticated Edge API; direct client
-- access is intentionally revoked so credential-table details never leak to the browser.

create or replace view public.vw_google_ads_connection_status
with (security_invoker = true)
as
select
  i.user_id,
  coalesce(i.clinic_id, c.clinic_id) as clinic_id,
  i.id as integration_id,
  i.status,
  nullif(
    coalesce(
      i.metadata->>'customerId',
      i.metadata->>'customer_id',
      ''
    ),
    ''
  ) as customer_id,
  (c.id is not null) as credential_present,
  c.created_at as credential_created_at,
  c.last_used as credential_last_used,
  i.last_sync,
  i.last_error,
  i.updated_at
from public.integrations i
left join public.credentials c
  on c.user_id = i.user_id
 and c.service = 'google_ads'
where i.service = 'google_ads';

revoke all on public.vw_google_ads_connection_status from public;
revoke all on public.vw_google_ads_connection_status from anon;
revoke all on public.vw_google_ads_connection_status from authenticated;
grant select on public.vw_google_ads_connection_status to service_role;

comment on view public.vw_google_ads_connection_status is
  'Secret-free Google Ads integration/credential status for authenticated server-side API output.';
