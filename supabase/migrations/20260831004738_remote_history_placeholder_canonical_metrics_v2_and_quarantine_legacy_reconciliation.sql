-- Remote migration history shim for version 20260831004738.
--
-- Production recorded `canonical_metrics_v2_and_quarantine_legacy_reconciliation`
-- while PR #376 was already in flight. The production schema is the source of truth
-- for this already-applied version; do not replay or mutate it from this parity fix.
-- Its resulting schema contract must be captured by the non-destructive clean-build
-- baseline tracked in #359 before historical replay is declared deterministic.
do $noop$
begin
  null;
end
$noop$;
