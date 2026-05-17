-- Ensure automation upserts using ON CONFLICT (user_id, ad_account_id, date)
-- have a matching arbiter after the clinic-scoped primary key migration.

DO $$
BEGIN
  IF to_regclass('public.meta_daily_insights') IS NULL THEN
    RAISE NOTICE 'Skipping meta_daily_insights user/account/date key: table does not exist';
    RETURN;
  END IF;

  -- Keep clinic-scoped data complete before adding the legacy user-scoped
  -- compatibility key used by Node automation scripts.
  IF to_regclass('public.users') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'meta_daily_insights'
         AND column_name = 'clinic_id'
     ) THEN
    UPDATE public.meta_daily_insights mdi
    SET clinic_id = u.clinic_id
    FROM public.users u
    WHERE mdi.user_id = u.id
      AND mdi.clinic_id IS NULL
      AND u.clinic_id IS NOT NULL;
  END IF;

  -- Defensive cleanup for environments where the old user-scoped key was absent
  -- and duplicate rows may already have been inserted before this migration.
  DELETE FROM public.meta_daily_insights mdi
  USING public.meta_daily_insights newer
  WHERE mdi.user_id = newer.user_id
    AND mdi.ad_account_id = newer.ad_account_id
    AND mdi.date = newer.date
    AND mdi.ctid < newer.ctid;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.meta_daily_insights'::regclass
      AND conname = 'meta_daily_insights_user_account_date_uniq'
  ) THEN
    ALTER TABLE public.meta_daily_insights
      ADD CONSTRAINT meta_daily_insights_user_account_date_uniq
      UNIQUE (user_id, ad_account_id, date);
  END IF;
END $$;
