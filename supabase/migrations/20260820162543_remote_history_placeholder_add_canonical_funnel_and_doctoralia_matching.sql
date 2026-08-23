-- Remote migration history shim for version 20260820162543.
--
-- Production Supabase already records add_canonical_funnel_and_doctoralia_matching
-- as applied under this exact version, while the canonical repository no longer
-- contains the historical migration file. Keep this deterministic no-op so local
-- and remote migration ledgers can be compared without destructive history repair.
do $noop$
begin
  null;
end
$noop$;
