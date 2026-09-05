-- Reconcile the durable attribution contract before installing the invariant.
-- Historical replay created several lineage columns as TEXT while Production
-- already stores the bounded VARCHAR shape. Do not ALTER TYPE here: reporting
-- views legitimately depend on these columns and PostgreSQL rejects even a
-- same-shape ALTER TYPE when a view/rule depends on the column. Enforce the
-- contract with validation + CHECK/NOT NULL constraints instead, which works
-- for both historical TEXT replay and the current Production shape.
do $meta_attribution_schema_contract$
declare
  v_invalid integer;
begin
  if to_regclass('public.leads') is null
     or to_regclass('public.meta_attribution') is null
     or to_regclass('public.integrations') is null then
    raise exception 'Meta attribution invariant requires leads, meta_attribution and integrations';
  end if;

  select count(*)
  into v_invalid
  from public.meta_attribution a
  where nullif(btrim(coalesce(a.leadgen_id::text, '')), '') is null
     or a.captured_at is null
     or length(coalesce(a.leadgen_id::text, '')) > 64
     or length(coalesce(a.page_id::text, '')) > 64
     or length(coalesce(a.form_id::text, '')) > 64
     or length(coalesce(a.campaign_id::text, '')) > 64
     or length(coalesce(a.campaign_name::text, '')) > 255
     or length(coalesce(a.adset_id::text, '')) > 64
     or length(coalesce(a.adset_name::text, '')) > 255
     or length(coalesce(a.ad_id::text, '')) > 64
     or length(coalesce(a.ad_name::text, '')) > 255;

  if v_invalid <> 0 then
    raise exception 'Meta attribution schema contract rejected % incompatible row(s)', v_invalid;
  end if;
end;
$meta_attribution_schema_contract$;

alter table public.meta_attribution
  alter column leadgen_id set not null,
  alter column captured_at set not null,
  add constraint meta_attribution_leadgen_id_length_chk check (nullif(btrim(leadgen_id::text), '') is not null and length(leadgen_id::text) <= 64),
  add constraint meta_attribution_page_id_length_chk check (page_id is null or length(page_id::text) <= 64),
  add constraint meta_attribution_form_id_length_chk check (form_id is null or length(form_id::text) <= 64),
  add constraint meta_attribution_campaign_id_length_chk check (campaign_id is null or length(campaign_id::text) <= 64),
  add constraint meta_attribution_campaign_name_length_chk check (campaign_name is null or length(campaign_name::text) <= 255),
  add constraint meta_attribution_adset_id_length_chk check (adset_id is null or length(adset_id::text) <= 64),
  add constraint meta_attribution_adset_name_length_chk check (adset_name is null or length(adset_name::text) <= 255),
  add constraint meta_attribution_ad_id_length_chk check (ad_id is null or length(ad_id::text) <= 64),
  add constraint meta_attribution_ad_name_length_chk check (ad_name is null or length(ad_name::text) <= 255);

-- Ensure private schema exists and restrict public access before defining
-- privileged security definer helper functions.
create schema if not exists private authorization postgres;
revoke all on schema private from public;

-- Resolve page ownership once at the database boundary. Explicit lead metadata
-- wins. Otherwise a page may be inferred only from one connected meta_ads
-- integration for the same user + clinic. Ambiguity fails closed.
create or replace function private.nvx_resolve_meta_page_id(p_lead public.leads)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_explicit_page_id text;
  v_candidate_pages text[];
begin
  v_explicit_page_id := coalesce(
    nullif(btrim(coalesce(p_lead.metadata ->> 'page_id', '')), ''),
    nullif(btrim(coalesce(p_lead.metadata ->> 'pageId', '')), '')
  );
  if v_explicit_page_id is not null then
    return v_explicit_page_id;
  end if;

  select array_agg(q.page_id order by q.page_id)
  into v_candidate_pages
  from (
    select distinct coalesce(
      nullif(btrim(coalesce(i.metadata ->> 'page_id', '')), ''),
      nullif(btrim(coalesce(i.metadata ->> 'pageId', '')), '')
    ) as page_id
    from public.integrations i
    where i.user_id = p_lead.user_id
      and i.clinic_id is not distinct from p_lead.clinic_id
      and lower(btrim(coalesce(i.service::text, ''))) = 'meta_ads'
      and lower(btrim(coalesce(i.status::text, ''))) = 'connected'
  ) q
  where q.page_id is not null;

  if coalesce(cardinality(v_candidate_pages), 0) > 1 then
    raise exception 'meta_leadgen page ownership is ambiguous for user/clinic';
  end if;

  return v_candidate_pages[1];
end;
$$;

revoke all on function private.nvx_resolve_meta_page_id(public.leads) from public;

create or replace function private.nvx_converge_meta_lead_attribution(p_lead public.leads)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leadgen_id text;
  v_page_id text;
  v_form_id text;
  v_campaign_id text;
  v_campaign_name text;
  v_adset_id text;
  v_adset_name text;
  v_ad_id text;
  v_ad_name text;
  v_captured_at timestamptz;
begin
  if lower(btrim(coalesce(p_lead.source::text, ''))) <> 'meta_leadgen'
     or p_lead.deleted_at is not null then
    return;
  end if;

  v_leadgen_id := nullif(btrim(coalesce(p_lead.external_id::text, '')), '');
  if v_leadgen_id is null then
    raise exception 'meta_leadgen lead requires external_id before attribution';
  end if;
  if length(v_leadgen_id) > 64 then
    raise exception 'meta_leadgen external_id exceeds meta_attribution.leadgen_id contract';
  end if;

  v_form_id := coalesce(
    nullif(btrim(coalesce(p_lead.meta_form_id::text, '')), ''),
    nullif(btrim(coalesce(p_lead.form_id::text, '')), '')
  );
  v_campaign_id := nullif(btrim(coalesce(p_lead.campaign_id::text, '')), '');
  v_campaign_name := nullif(left(btrim(coalesce(p_lead.campaign_name::text, '')), 255), '');
  v_adset_id := nullif(btrim(coalesce(p_lead.adset_id::text, '')), '');
  v_adset_name := nullif(left(btrim(coalesce(p_lead.adset_name::text, '')), 255), '');
  v_ad_id := coalesce(
    nullif(btrim(coalesce(p_lead.meta_ad_id::text, '')), ''),
    nullif(btrim(coalesce(p_lead.ad_id::text, '')), '')
  );
  v_ad_name := left(coalesce(
    nullif(btrim(coalesce(p_lead.meta_ad_name::text, '')), ''),
    nullif(btrim(coalesce(p_lead.ad_name::text, '')), '')
  ), 255);
  v_page_id := private.nvx_resolve_meta_page_id(p_lead);
  v_captured_at := coalesce(p_lead.created_at_meta, p_lead.created_at, statement_timestamp());

  if length(coalesce(v_page_id, '')) > 64
     or length(coalesce(v_form_id, '')) > 64
     or length(coalesce(v_campaign_id, '')) > 64
     or length(coalesce(v_adset_id, '')) > 64
     or length(coalesce(v_ad_id, '')) > 64 then
    raise exception 'meta_leadgen lineage identifier exceeds meta_attribution contract';
  end if;

  insert into public.meta_attribution (
    lead_id,
    leadgen_id,
    page_id,
    form_id,
    campaign_id,
    campaign_name,
    adset_id,
    adset_name,
    ad_id,
    ad_name,
    captured_at,
    updated_at
  ) values (
    p_lead.id,
    v_leadgen_id,
    v_page_id,
    v_form_id,
    v_campaign_id,
    v_campaign_name,
    v_adset_id,
    v_adset_name,
    v_ad_id,
    v_ad_name,
    v_captured_at,
    statement_timestamp()
  )
  on conflict (lead_id) do update set
    leadgen_id = excluded.leadgen_id,
    page_id = coalesce(excluded.page_id, public.meta_attribution.page_id),
    form_id = coalesce(excluded.form_id, public.meta_attribution.form_id),
    campaign_id = coalesce(excluded.campaign_id, public.meta_attribution.campaign_id),
    campaign_name = coalesce(excluded.campaign_name, public.meta_attribution.campaign_name),
    adset_id = coalesce(excluded.adset_id, public.meta_attribution.adset_id),
    adset_name = coalesce(excluded.adset_name, public.meta_attribution.adset_name),
    ad_id = coalesce(excluded.ad_id, public.meta_attribution.ad_id),
    ad_name = coalesce(excluded.ad_name, public.meta_attribution.ad_name),
    captured_at = least(public.meta_attribution.captured_at, excluded.captured_at),
    updated_at = statement_timestamp();
end;
$$;

revoke all on function private.nvx_converge_meta_lead_attribution(public.leads) from public;

-- Before persistence, materialize a uniquely resolved Meta page into leads so
-- attribution ownership remains stable even if integration configuration later
-- changes. This also makes the lead itself the durable lineage source.
create or replace function private.nvx_prepare_meta_lead_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page_id text;
begin
  if lower(btrim(coalesce(new.source::text, ''))) <> 'meta_leadgen'
     or new.deleted_at is not null then
    return new;
  end if;

  v_page_id := private.nvx_resolve_meta_page_id(new);
  if v_page_id is not null
     and nullif(btrim(coalesce(new.metadata ->> 'page_id', '')), '') is null
     and nullif(btrim(coalesce(new.metadata ->> 'pageId', '')), '') is null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('page_id', v_page_id);
  end if;
  return new;
end;
$$;

revoke all on function private.nvx_prepare_meta_lead_lineage() from public;

create or replace function private.nvx_ensure_meta_lead_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.nvx_converge_meta_lead_attribution(new);
  return new;
end;
$$;

revoke all on function private.nvx_ensure_meta_lead_attribution() from public;

-- Remove every prior form of the invariant before rebuilding the ordered
-- BEFORE (lineage preparation) + AFTER (attribution convergence) boundary.
drop trigger if exists meta_lead_lineage_prepare on public.leads;
drop trigger if exists meta_lead_attribution_invariant on public.leads;
drop trigger if exists meta_lead_attribution_insert_invariant on public.leads;
drop trigger if exists meta_lead_attribution_update_invariant on public.leads;

create trigger meta_lead_lineage_prepare
before insert or update of source, user_id, clinic_id, metadata, deleted_at
on public.leads
for each row
execute function private.nvx_prepare_meta_lead_lineage();

-- Repair current live orphans through the same resolver + convergence owners.
-- Updating metadata through the BEFORE trigger persists uniquely resolvable page
-- ownership on the lead before the attribution row is created.
do $$
declare
  v_lead public.leads%rowtype;
  v_orphans integer;
begin
  for v_lead in
    select l.*
    from public.leads l
    left join public.meta_attribution a on a.lead_id = l.id
    where lower(btrim(coalesce(l.source::text, ''))) = 'meta_leadgen'
      and l.deleted_at is null
      and a.lead_id is null
    order by l.created_at, l.id
  loop
    update public.leads
    set metadata = coalesce(metadata, '{}'::jsonb)
    where id = v_lead.id
    returning * into v_lead;

    perform private.nvx_converge_meta_lead_attribution(v_lead);
  end loop;

  select count(*)
  into v_orphans
  from public.leads l
  left join public.meta_attribution a on a.lead_id = l.id
  where lower(btrim(coalesce(l.source::text, ''))) = 'meta_leadgen'
    and l.deleted_at is null
    and a.lead_id is null;

  if v_orphans <> 0 then
    raise exception 'Meta lead attribution invariant failed: % live orphan(s) remain', v_orphans;
  end if;
end;
$$;

create trigger meta_lead_attribution_insert_invariant
after insert on public.leads
for each row
when (lower(btrim(coalesce(new.source::text, ''))) = 'meta_leadgen')
execute function private.nvx_ensure_meta_lead_attribution();

create trigger meta_lead_attribution_update_invariant
after update of
  source,
  user_id,
  clinic_id,
  external_id,
  metadata,
  form_id,
  meta_form_id,
  campaign_id,
  campaign_name,
  adset_id,
  adset_name,
  ad_id,
  meta_ad_id,
  ad_name,
  meta_ad_name,
  created_at_meta,
  created_at,
  deleted_at
on public.leads
for each row
when (lower(btrim(coalesce(new.source::text, ''))) = 'meta_leadgen')
execute function private.nvx_ensure_meta_lead_attribution();
