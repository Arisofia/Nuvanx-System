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

  v_page_id := nullif(btrim(coalesce(p_lead.metadata ->> 'page_id', '')), '');
  v_form_id := nullif(btrim(coalesce(p_lead.meta_form_id, p_lead.form_id, '')), '');
  v_campaign_id := nullif(btrim(coalesce(p_lead.campaign_id, '')), '');
  v_campaign_name := nullif(left(btrim(coalesce(p_lead.campaign_name, '')), 255), '');
  v_adset_id := nullif(btrim(coalesce(p_lead.adset_id, '')), '');
  v_adset_name := nullif(left(btrim(coalesce(p_lead.adset_name, '')), 255), '');
  v_ad_id := nullif(btrim(coalesce(p_lead.meta_ad_id, p_lead.ad_id, '')), '');
  v_ad_name := nullif(left(btrim(coalesce(p_lead.meta_ad_name, p_lead.ad_name, '')), 255), '');
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

-- The database boundary is the canonical owner. Inserts always converge the
-- lineage. Updates rerun convergence only when a lineage-bearing field can
-- have changed, avoiding writes to meta_attribution for pipeline-only updates.
drop trigger if exists meta_lead_attribution_invariant on public.leads;
drop trigger if exists meta_lead_attribution_insert_invariant on public.leads;
drop trigger if exists meta_lead_attribution_update_invariant on public.leads;

create trigger meta_lead_attribution_insert_invariant
after insert on public.leads
for each row
when (lower(btrim(coalesce(new.source::text, ''))) = 'meta_leadgen')
execute function private.nvx_ensure_meta_lead_attribution();

create trigger meta_lead_attribution_update_invariant
after update of
  source,
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

-- Repair current live orphans through the exact same convergence function used
-- by future writes. Any missing/oversized identity raises and the migration
-- runner's transaction rolls back instead of persisting a weaker contract.
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