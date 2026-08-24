# Daily automation ownership

## Meta Ads insights

There are two intentionally different executions of the same idempotent Meta insight ingestion path:

1. **Primary ingestion — Supabase pg_cron**
   - job: `fetch-meta-daily-insights`
   - schedule: `0 5 * * *` (05:00 UTC)
   - scope: rolling lookback configured as `days = 2`
   - owner: production database scheduler

2. **Reconciliation/backfill — GitHub Master System**
   - job: `Scheduled · Daily Sync`
   - schedule: `0 7 * * *` (07:00 UTC)
   - default scope: UTC month-to-date (`YYYY-MM-01` through current UTC date)
   - manual scope: explicit `from_date` / `to_date` when `daily_sync` is dispatched
   - accepted explicit range: both dates are required, must be valid `YYYY-MM-DD`, ordered, and no more than 93 inclusive days
   - owner: GitHub Actions

`daily-aggregates` consumes the workflow's `from` / `to` values directly. If no explicit range is supplied, the legacy `days` lookback remains supported for the pg_cron owner.

The two jobs are not independent writers. Both converge through `daily-aggregates` and the `meta_daily_insights` upsert key `clinic_id,ad_account_id,date`, so reruns update the same daily fact instead of duplicating rows.

The ingestion function reads both credential services, `meta` and `meta_ads`. Legacy credentials use `META_APP_SECRET`; canonical `meta_ads` credentials use `META_CANONICAL_APP_SECRET` (falling back to `META_REPORTING_APP_SECRET` when explicitly configured). The credentials query must match the production schema and must not reference a `credentials.deleted_at` column, because that column does not exist.

Do not add a third scheduled Meta daily owner. The executable contract test scans scheduler definitions in `.github/workflows` and `supabase/migrations` and permits only the canonical pg_cron migration and Master System workflow.

## Control Centre daily insight

- job: `nvx-control-centre-daily-insight`
- schedule: `50 7 * * *` (07:50 UTC)
- owner: production database scheduler
- function: `public.nvx_generate_daily_control_centre_insights()`

This is downstream analysis, not another Meta ingestion writer. The function is expected to persist `agent_outputs.agent_type = 'daily-insight'` records. The executable body was production-validated manually on 2026-08-24 before its first scheduled window.
