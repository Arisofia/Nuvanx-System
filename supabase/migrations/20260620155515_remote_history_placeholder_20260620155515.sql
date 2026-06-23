-- Remote migration history shim for version 20260620155515.
--
-- The linked Supabase database already records this version as applied, but the
-- local migration file was absent. Keep this deterministic no-op so CI/CD can
-- compare local migration versions with the remote history without requiring a
-- destructive history repair.
do $noop$
begin
  null;
end
$noop$;
