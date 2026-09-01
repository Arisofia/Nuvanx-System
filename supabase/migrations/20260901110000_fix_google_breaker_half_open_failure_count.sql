-- Forward-only fix for Google Ads circuit breaker half-open failure count.
-- 
-- Context: Migration 20260901093500 was restored to its authoritative applied blob
-- by PR #444, which set failure_count = 0 when resetting the breaker to half_open.
-- This defeats the half-open behavior: a failed probe increments to 1 and
-- transitions to closed instead of reopening immediately.
--
-- This migration restores the threshold-level failure count (>= 3) so that
-- if the half-open probe fails, nvx_control_centre_provider_finish_failure
-- immediately reopens the breaker rather than transitioning it back to 'closed'.
-- If the probe succeeds, finish_success will clear failure_count.

begin;

UPDATE public.control_centre_provider_cache
SET
  failure_count      = greatest(coalesce(failure_count, 0), 3),
  updated_at         = pg_catalog.now()
WHERE provider = 'google'
  AND breaker_state = 'half_open'
  AND failure_count < 3;

commit;
