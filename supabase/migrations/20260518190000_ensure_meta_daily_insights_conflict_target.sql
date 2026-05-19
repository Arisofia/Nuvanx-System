-- Ensure Meta daily backfills can upsert by clinic/account/date in every env.
-- Some production databases still have the legacy user-scoped primary key, which
-- makes ON CONFLICT (clinic_id, ad_account_id, date) fail.

BEGIN;

ALTER TABLE public.meta_daily_insights
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.meta_daily_insights mdi
SET clinic_id = u.clinic_id
FROM public.users u
WHERE mdi.user_id = u.id
  AND mdi.clinic_id IS NULL
  AND u.clinic_id IS NOT NULL;

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id, ad_account_id, date
      ORDER BY updated_at DESC NULLS LAST, user_id
    ) AS rn
  FROM public.meta_daily_insights
  WHERE clinic_id IS NOT NULL
)
DELETE FROM public.meta_daily_insights mdi
USING ranked r
WHERE mdi.ctid = r.ctid
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS meta_daily_insights_clinic_account_date_uidx
  ON public.meta_daily_insights (clinic_id, ad_account_id, date);

COMMIT;
