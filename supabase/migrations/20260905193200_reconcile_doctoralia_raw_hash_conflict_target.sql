-- The canonical Doctoralia mirror uses
--   ON CONFLICT (raw_hash) WHERE raw_hash IS NOT NULL
-- Production already has this exact partial unique index. Clean previews did
-- not, so codify the runtime contract instead of relying on historical drift.

begin;

do $$
begin
  if to_regclass('public.doctoralia_raw') is null then
    raise exception 'doctoralia_raw is required by the canonical Doctoralia mirror';
  end if;
end
$$;

create unique index if not exists doctoralia_raw_hash_idx
  on public.doctoralia_raw(raw_hash)
  where raw_hash is not null;

commit;
