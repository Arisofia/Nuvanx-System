-- Canonical Google Ads daily performance storage and multi-account integration support.
-- Google Ads may have multiple customer accounts under the same NUVANX user.

begin;

-- Preserve the existing one-row-per-service contract for every connector except
-- Google Ads, where one user legitimately owns multiple customer accounts.
alter table public.integrations
  drop constraint if exists integrations_service_unique;

alter table public.integrations
  drop constraint if exists integrations_user_id_service_key;

alter table public.integrations
  drop constraint if exists integrations_user_service_uq;

drop index if exists public.integrations_user_service_uq;
drop index if exists public.integrations_user_id_service_key;
drop index if exists public.integrations_service_unique;
drop index if exists public.integrations_user_service_unique_idx;
drop index if exists public.integrations_user_id_service_unique_idx;

drop index if exists public.integrations_service_unique_non_google_ads;
create unique index if not exists integrations_service_unique_non_google_ads
  on public.integrations (user_id, service)
  where service <> 'google_ads';

create unique index if not exists integrations_google_ads_user_customer_unique
  on public.integrations (
    user_id,
    (regexp_replace(
      coalesce(nullif(metadata->>'customerId', ''), nullif(metadata->>'customer_id', ''), ''),
      '\D',
      '',
      'g'
    ))
  )
  where service = 'google_ads'
    and regexp_replace(
      coalesce(nullif(metadata->>'customerId', ''), nullif(metadata->>'customer_id', ''), ''),
      '\D',
      '',
      'g'
    ) <> '';

create table if not exists public.google_ads_daily_insights (
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid null references public.clinics(id) on delete set null,
  integration_id uuid not null references public.integrations(id) on delete restrict,
  customer_id text not null,
  campaign_id text not null,
  campaign_name text not null,
  date date not null,
  campaign_status text null,
  campaign_type text null,
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  spend numeric(18,6) not null default 0 check (spend >= 0),
  conversions numeric(18,6) not null default 0 check (conversions >= 0),
  conversion_value numeric(18,6) not null default 0,
  ctr numeric(18,10) not null default 0,
  average_cpc numeric(18,6) not null default 0 check (average_cpc >= 0),
  cost_per_conversion numeric(18,6) not null default 0 check (cost_per_conversion >= 0),
  currency_code text null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id, date)
);

create index if not exists google_ads_daily_insights_customer_date_idx
  on public.google_ads_daily_insights (customer_id, date desc);

create index if not exists google_ads_daily_insights_campaign_date_idx
  on public.google_ads_daily_insights (campaign_id, date desc);

create index if not exists google_ads_daily_insights_clinic_date_idx
  on public.google_ads_daily_insights (clinic_id, date desc)
  where clinic_id is not null;

alter table public.google_ads_daily_insights enable row level security;

revoke all on public.google_ads_daily_insights from public;
revoke all on public.google_ads_daily_insights from anon;
revoke all on public.google_ads_daily_insights from authenticated;
grant select, insert, update, delete on public.google_ads_daily_insights to service_role;

create policy google_ads_daily_insights_service_role
  on public.google_ads_daily_insights
  for all
  to service_role
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

comment on table public.google_ads_daily_insights is
  'Canonical Google Ads campaign-day facts synced directly from Google Ads API; server-side only.';
comment on column public.google_ads_daily_insights.customer_id is
  'Google Ads customer ID normalized to digits only.';
comment on column public.google_ads_daily_insights.conversions is
  'Google Ads conversions metric; numeric because attributed conversions may be fractional.';

commit;
