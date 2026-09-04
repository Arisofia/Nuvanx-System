begin;

create or replace function private.nvx_ensure_meta_lead_attribution()
returns trigger
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
  if lower(btrim(coalesce(new.source::text, ''))) <> 'meta_leadgen'
     or new.deleted_at is not null then
    return new;
  end if;

  v_leadgen_id := nullif(btrim(coalesce(new.external_id::text, '')), '');
  if v_leadgen_id is null then
    raise exception 'meta_leadgen lead requires external_id before attribution';
  end if;
  if length(v_leadgen_id) > 64 then
    raise exception 'meta_leadgen external_id exceeds meta_attribution.leadgen_id contract';
  end if;

  -- Avoid rewriting attribution on unrelated lead updates once the invariant is
  -- already satisfied. Relevant lineage changes still converge through the
  -- upsert below.
  if tg_op = 'UPDATE'
     and old.source is not distinct from new.source
     and old.external_id is not distinct from new.external_id
     and old.form_id is not distinct from new.form_id
     and old.meta_form_id is not distinct from new.meta_form_id
     and old.campaign_id is not distinct from new.campaign_id
     and old.campaign_name is not distinct from new.campaign_name
     and old.adset_id is not distinct from new.adset_id
     and old.adset_name is not distinct from new.adset_name
     and old.ad_id is not distinct from new.ad_id
     and old.meta_ad_id is not distinct from new.meta_ad_id
     and old.ad_name is not distinct from new.ad_name
     and old.created_at_meta is not distinct from new.created_at_meta
     and exists (select 1 from public.meta_attribution a where a.lead_id = new.id) then
    return new;
  end if;

  v_page_id := nullif(btrim(coalesce(new.metadata ->> 'page_id', '')), '');
  v_form_id := nullif(btrim(coalesce(new.meta_form_id, new.form_id, '')), '');
  v_campaign_id := nullif(btrim(coalesce(new.campaign_id, '')), '');
  v_campaign_name := nullif(left(btrim(coalesce(new.campaign_name, '')), 255), '');
  v_adset_id := nullif(btrim(coalesce(new.adset_id, '')), '');
  v_adset_name := nullif(left(btrim(coalesce(new.adset_name, '')), 255), '');
  v_ad_id := nullif(btrim(coalesce(new.meta_ad_id, new.ad_id, '')), '');
  v_ad_name := nullif(left(btrim(coalesce(new.meta_ad_name, new.ad_name, '')), 255), '');
  v_captured_at := coalesce(new.created_at_meta, new.created_at, statement_timestamp());

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
    new.id,
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

  return new;
end;
$$;

revoke all on function private.nvx_ensure_meta_lead_attribution() from public;

-- The DB boundary is the canonical owner of the invariant. Every insertion
-- route (Meta webhook, provider backfill, or future governed owner) must create
-- lineage in the same transaction as the lead row.
drop trigger if exists meta_lead_attribution_invariant on public.leads;
create trigger meta_lead_attribution_invariant
after insert or update on public.leads
for each row
when (lower(btrim(coalesce(new.source::text, ''))) = 'meta_leadgen')
execute function private.nvx_ensure_meta_lead_attribution();

-- Repair only live orphaned Meta leads by contract, never by hard-coded lead
-- identifiers. Existing attribution rows are left intact.
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
)
select
  l.id,
  btrim(l.external_id),
  nullif(btrim(coalesce(l.metadata ->> 'page_id', '')), ''),
  nullif(btrim(coalesce(l.meta_form_id, l.form_id, '')), ''),
  nullif(btrim(coalesce(l.campaign_id, '')), ''),
  nullif(left(btrim(coalesce(l.campaign_name, '')), 255), ''),
  nullif(btrim(coalesce(l.adset_id, '')), ''),
  nullif(left(btrim(coalesce(l.adset_name, '')), 255), ''),
  nullif(btrim(coalesce(l.meta_ad_id, l.ad_id, '')), ''),
  nullif(left(btrim(coalesce(l.meta_ad_name, l.ad_name, '')), 255), ''),
  coalesce(l.created_at_meta, l.created_at, statement_timestamp()),
  statement_timestamp()
from public.leads l
left join public.meta_attribution a on a.lead_id = l.id
where lower(btrim(coalesce(l.source::text, ''))) = 'meta_leadgen'
  and l.deleted_at is null
  and a.lead_id is null
  and nullif(btrim(coalesce(l.external_id::text, '')), '') is not null;

do $$
declare
  v_orphans integer;
begin
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

commit;
