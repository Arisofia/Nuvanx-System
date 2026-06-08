alter table public.meta_ig_account_daily
  add column if not exists followers_total integer,
  add column if not exists new_followers integer,
  add column if not exists unfollows integer,
  add column if not exists paid_follows integer,
  add column if not exists organic_follows integer,
  add column if not exists source_quality text;

alter table public.meta_daily_insights
  add column if not exists source_quality text;

alter table public.meta_organic_daily
  add column if not exists source_quality text;

alter table public.meta_ig_media_performance
  add column if not exists source_quality text;

alter table public.meta_post_performance
  add column if not exists source_quality text;

create index if not exists meta_ig_account_daily_ig_date_idx
  on public.meta_ig_account_daily (ig_id, date desc);

create index if not exists meta_daily_insights_account_date_idx
  on public.meta_daily_insights (ad_account_id, date desc);
