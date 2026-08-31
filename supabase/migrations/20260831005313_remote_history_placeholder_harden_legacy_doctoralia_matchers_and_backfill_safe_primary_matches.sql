-- Remote migration history shim for version 20260831005313.
--
-- Production recorded `harden_legacy_doctoralia_matchers_and_backfill_safe_primary_matches`
-- outside the current Git history while PR #376 was in flight. Production remains
-- the source of truth for this already-applied version; this no-op restores version
-- parity only and must not replay or reinterpret the production change.
--
-- The functional schema/function contract created by this remote migration must be
-- incorporated into the canonical clean-build baseline/forward contract tracked in
-- #359 before Supabase Branching is declared deterministic.
do $noop$
begin
  null;
end
$noop$;
