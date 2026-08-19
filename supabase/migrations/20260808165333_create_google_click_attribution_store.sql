-- Restored historical migration.
-- Production already records version 20260808165333 as create_google_click_attribution_store;
-- keeping the same version in Git restores clean-build parity without reapplying it
-- to production.

create table if not exists public.google_click_attributions (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  gclid text,
  gbraid text,
  wbraid text,
  gclsrc text,
  form_id text not null,
  landing_url text,
  source text not null default 'hubspot_web',
  captured_at timestamptz not null default now(),
  applied_lead_id uuid references public.leads(id) on delete set null,
  applied_at timestamptz,
  constraint google_click_attributions_email_hash_chk
    check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint google_click_attributions_click_id_chk
    check (
      nullif(btrim(gclid), '') is not null
      or nullif(btrim(gbraid), '') is not null
      or nullif(btrim(wbraid), '') is not null
    ),
  constraint google_click_attributions_gclid_len_chk
    check (gclid is null or length(gclid) between 1 and 512),
  constraint google_click_attributions_gbraid_len_chk
    check (gbraid is null or length(gbraid) between 1 and 512),
  constraint google_click_attributions_wbraid_len_chk
    check (wbraid is null or length(wbraid) between 1 and 512),
  constraint google_click_attributions_gclsrc_len_chk
    check (gclsrc is null or length(gclsrc) between 1 and 128),
  constraint google_click_attributions_form_id_len_chk
    check (length(form_id) between 1 and 80),
  constraint google_click_attributions_landing_url_len_chk
    check (landing_url is null or length(landing_url) <= 1000)
);

create unique index if not exists google_click_attributions_dedupe_uidx
  on public.google_click_attributions (
    email_hash,
    coalesce(gclid, ''),
    coalesce(gbraid, ''),
    coalesce(wbraid, ''),
    form_id
  );

create index if not exists google_click_attributions_email_hash_idx
  on public.google_click_attributions (email_hash, captured_at desc);

alter table public.google_click_attributions enable row level security;
revoke all on public.google_click_attributions from public, anon, authenticated;
grant all on public.google_click_attributions to service_role;
