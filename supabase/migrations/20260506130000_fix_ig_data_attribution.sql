-- =============================================================================
-- Fix: re-attribute meta_ig_account_daily and meta_ig_media_performance to the
-- correct user, mirroring the same repair done for meta_organic_daily.
--
-- Root cause: the backfill script resolved user_id from the first meta
-- integration when the target user's pageId was absent, attributing IG data
-- to user 6692f0b3... instead of the user who owns the Facebook Page
-- 685010274687129 (a2f2b8a1...).
--
-- Logic (fully dynamic, no hardcoded UUIDs):
--   1. Identify the correct owner via meta_organic_daily (page_id = 685010274687129)
--   2. Discover the ig_id currently in meta_ig_account_daily under a different user
--   3. Re-attribute ig daily + media rows
--   4. Stamp igBusinessAccountId into the correct user's integration metadata
-- =============================================================================

DO $$
DECLARE
  v_correct_user  UUID;
  v_wrong_user    UUID;
  v_ig_id         TEXT;
  v_daily_moved   INT;
  v_media_moved   INT;
BEGIN
  -- ── 1. Find correct owner (has organic data for page 685010274687129) ─────
  SELECT DISTINCT user_id INTO v_correct_user
  FROM public.meta_organic_daily
  WHERE page_id = '685010274687129'
  LIMIT 1;

  IF v_correct_user IS NULL THEN
    RAISE NOTICE 'fix_ig_attribution: meta_organic_daily has no rows for page 685010274687129 — skipping.';
    RETURN;
  END IF;

  -- ── 2. Find ig_id + wrong owner (ig data NOT already on correct user) ─────
  SELECT DISTINCT ig_id, user_id INTO v_ig_id, v_wrong_user
  FROM public.meta_ig_account_daily
  WHERE user_id <> v_correct_user
  ORDER BY ig_id
  LIMIT 1;

  IF v_ig_id IS NULL THEN
    RAISE NOTICE 'fix_ig_attribution: meta_ig_account_daily already attributed correctly or empty — skipping.';
    RETURN;
  END IF;

  -- ── 3. Re-attribute ig daily ──────────────────────────────────────────────
  UPDATE public.meta_ig_account_daily
  SET user_id = v_correct_user
  WHERE user_id = v_wrong_user;
  GET DIAGNOSTICS v_daily_moved = ROW_COUNT;

  -- ── 4. Re-attribute ig media performance ─────────────────────────────────
  UPDATE public.meta_ig_media_performance
  SET user_id = v_correct_user
  WHERE user_id = v_wrong_user;
  GET DIAGNOSTICS v_media_moved = ROW_COUNT;

  -- ── 5. Stamp igBusinessAccountId in correct user's integration metadata ──
  UPDATE public.integrations
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{igBusinessAccountId}',
    to_jsonb(v_ig_id)
  )
  WHERE user_id = v_correct_user
    AND service  = 'meta';

  RAISE NOTICE 'fix_ig_attribution: moved % daily rows + % media rows from % → %; igBusinessAccountId=% stamped.',
    v_daily_moved, v_media_moved, v_wrong_user, v_correct_user, v_ig_id;
END $$;
