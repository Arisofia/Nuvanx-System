-- Remote migration history shim for version 20260830202904.
--
-- The linked Supabase production database already records this version as applied,
-- but the corresponding local migration file was absent. Keep this deterministic
-- no-op so Database Branching and CI/CD can compare local migration versions with
-- the remote history without rewriting or repairing the production migration ledger.
do $noop$
begin
  null;
end
$noop$;
