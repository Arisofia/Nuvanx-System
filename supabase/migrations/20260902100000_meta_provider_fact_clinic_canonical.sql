-- Root-cause invariant for persisted Meta provider facts.
--
-- The historical tables use user-scoped primary keys even though the provider
-- facts are clinic-scoped. Multiple members of the same clinic can therefore
-- persist the same Meta fact under different user_id values. Keep the existing
-- primary keys for compatibility, but make clinic_id mandatory and add the
-- provider-identity uniqueness that all new writes must target.
--
-- This migration is deliberately fail-closed: it never chooses a duplicate
-- winner and never backfills clinic ownership. Any null clinic or duplicate
-- provider fact must be reviewed explicitly before deployment.

BEGIN;

DO $meta_provider_fact_guard$
BEGIN
  IF to_regclass('public.meta_organic_daily') IS NULL
     OR to_regclass('public.meta_post_performance') IS NULL
     OR to_regclass('public.meta_ig_account_daily') IS NULL
     OR to_regclass('public.meta_ig_media_performance') IS NULL THEN
    RAISE EXCEPTION 'Meta provider fact tables are required before clinic-canonical reconciliation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.meta_organic_daily WHERE clinic_id IS NULL) THEN
    RAISE EXCEPTION 'meta_organic_daily contains clinic_id NULL; refusing canonical uniqueness';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meta_post_performance WHERE clinic_id IS NULL) THEN
    RAISE EXCEPTION 'meta_post_performance contains clinic_id NULL; refusing canonical uniqueness';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meta_ig_account_daily WHERE clinic_id IS NULL) THEN
    RAISE EXCEPTION 'meta_ig_account_daily contains clinic_id NULL; refusing canonical uniqueness';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meta_ig_media_performance WHERE clinic_id IS NULL) THEN
    RAISE EXCEPTION 'meta_ig_media_performance contains clinic_id NULL; refusing canonical uniqueness';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_organic_daily
    GROUP BY clinic_id, page_id, date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'meta_organic_daily contains duplicate clinic/page/date provider facts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_post_performance
    GROUP BY clinic_id, page_id, post_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'meta_post_performance contains duplicate clinic/page/post provider facts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_ig_account_daily
    GROUP BY clinic_id, ig_id, date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'meta_ig_account_daily contains duplicate clinic/ig/date provider facts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_ig_media_performance
    GROUP BY clinic_id, ig_id, media_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'meta_ig_media_performance contains duplicate clinic/ig/media provider facts';
  END IF;
END;
$meta_provider_fact_guard$;

ALTER TABLE public.meta_organic_daily
  ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.meta_post_performance
  ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.meta_ig_account_daily
  ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.meta_ig_media_performance
  ALTER COLUMN clinic_id SET NOT NULL;

ALTER TABLE public.meta_organic_daily
  ADD CONSTRAINT meta_organic_daily_clinic_provider_key
  UNIQUE (clinic_id, page_id, date);

ALTER TABLE public.meta_post_performance
  ADD CONSTRAINT meta_post_performance_clinic_provider_key
  UNIQUE (clinic_id, page_id, post_id);

ALTER TABLE public.meta_ig_account_daily
  ADD CONSTRAINT meta_ig_account_daily_clinic_provider_key
  UNIQUE (clinic_id, ig_id, date);

ALTER TABLE public.meta_ig_media_performance
  ADD CONSTRAINT meta_ig_media_performance_clinic_provider_key
  UNIQUE (clinic_id, ig_id, media_id);

COMMENT ON CONSTRAINT meta_organic_daily_clinic_provider_key ON public.meta_organic_daily IS
  'Canonical Meta Organic daily fact identity within a clinic.';
COMMENT ON CONSTRAINT meta_post_performance_clinic_provider_key ON public.meta_post_performance IS
  'Canonical Meta Page post fact identity within a clinic.';
COMMENT ON CONSTRAINT meta_ig_account_daily_clinic_provider_key ON public.meta_ig_account_daily IS
  'Canonical Instagram account daily fact identity within a clinic.';
COMMENT ON CONSTRAINT meta_ig_media_performance_clinic_provider_key ON public.meta_ig_media_performance IS
  'Canonical Instagram media fact identity within a clinic.';

COMMIT;
