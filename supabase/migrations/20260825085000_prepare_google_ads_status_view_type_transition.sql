-- Clean-replay compatibility for the later Google Ads diagnostics view.
-- Production already exposes status as varchar(32), so this is a no-op there.
-- On a fresh replay the preceding baseline view exposes status as text; drop only
-- that incompatible shape so 20260825090205 can recreate the canonical view.

do $migration$
declare
  v_status_type text;
begin
  select c.data_type
    into v_status_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'vw_google_ads_connection_status'
    and c.column_name = 'status';

  if v_status_type = 'text' then
    execute 'drop view public.vw_google_ads_connection_status';
  end if;
end
$migration$;
