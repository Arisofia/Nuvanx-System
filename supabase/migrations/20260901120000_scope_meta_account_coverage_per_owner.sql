-- Scope Meta account coverage to the owning user/clinic.
-- Forward-only follow-up to the historical 20260901080400/20260901103000 view definitions.
-- Preserve the existing first four columns and append owner identity for unambiguous reporting.

CREATE OR REPLACE VIEW public.vw_meta_account_coverage
WITH (security_invoker = true)
AS
WITH canonical_by_owner AS (
  SELECT DISTINCT ON (
    CASE
      WHEN i.clinic_id IS NOT NULL THEN 'clinic:' || i.clinic_id::text
      ELSE 'user:' || i.user_id::text
    END
  )
    i.user_id,
    i.clinic_id,
    pg_catalog.regexp_replace(
      coalesce(
        nullif(i.metadata->>'adAccountId', ''),
        nullif(i.metadata->>'ad_account_id', '')
      ),
      '^act_',
      ''
    ) AS canonical_account_id
  FROM public.integrations i
  WHERE i.service = 'meta_ads'
    AND i.status = 'connected'
    AND pg_catalog.lower(coalesce(i.metadata->>'canonical', 'false')) = 'true'
    AND (i.user_id IS NOT NULL OR i.clinic_id IS NOT NULL)
    AND pg_catalog.regexp_replace(
      coalesce(
        nullif(i.metadata->>'adAccountId', ''),
        nullif(i.metadata->>'ad_account_id', '')
      ),
      '^act_',
      ''
    ) <> ''
  ORDER BY
    CASE
      WHEN i.clinic_id IS NOT NULL THEN 'clinic:' || i.clinic_id::text
      ELSE 'user:' || i.user_id::text
    END,
    i.updated_at DESC,
    i.id DESC
)
SELECT
  mdi.ad_account_id,
  pg_catalog.count(*) AS total_insights,
  pg_catalog.max(mdi.date) AS last_insight_date,
  CASE
    WHEN cbo.canonical_account_id IS NOT NULL
     AND cbo.canonical_account_id <> ''
     AND pg_catalog.regexp_replace(mdi.ad_account_id, '^act_', '') = cbo.canonical_account_id
      THEN 'canonical_runtime'
    ELSE 'historical_or_noncanonical'
  END AS classification,
  mdi.user_id,
  mdi.clinic_id
FROM public.meta_daily_insights mdi
LEFT JOIN canonical_by_owner cbo
  ON (
    mdi.clinic_id IS NOT NULL
    AND cbo.clinic_id = mdi.clinic_id
  )
  OR (
    cbo.clinic_id IS NULL
    AND cbo.user_id = mdi.user_id
  )
GROUP BY
  mdi.ad_account_id,
  mdi.user_id,
  mdi.clinic_id,
  cbo.canonical_account_id;

COMMENT ON VIEW public.vw_meta_account_coverage IS
'Coverage by Meta ad account scoped per owning clinic/user. Canonical classification derives from that owner''s connected meta_ads integration marked metadata.canonical=true; cross-owner facts are never aggregated.';
