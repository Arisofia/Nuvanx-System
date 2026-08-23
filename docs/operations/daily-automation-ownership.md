# Daily automation ownership

## Meta Ads insights

There are two intentionally different executions of the same idempotent Meta insight ingestion path:

1. **Primary ingestion — Supabase pg_cron**
   - job: `fetch-meta-daily-insights`
   - schedule: `0 5 * * *` (05:00 UTC)
   - scope: last 2 days
   - owner: production database scheduler

2. **Reconciliation/backfill — GitHub Master System**
   - job: `Scheduled · Daily Sync`
   - schedule: `0 7 * * *` (07:00 UTC)
   - scope: orchestration/backfill window selected by the workflow
   - owner: GitHub Actions

The two jobs are not independent writers. Both converge through `daily-aggregates` and the `meta_daily_insights` upsert key `clinic_id,ad_account_id,date`, so reruns update the same daily fact instead of duplicating rows.

Do not add a third Meta daily owner. A new scheduler must replace one of these roles or be explicitly documented as recovery-only.

## Control Centre daily insight

- job: `nvx-control-centre-daily-insight`
- schedule: `50 7 * * *` (07:50 UTC)
- owner: production database scheduler
- function: `public.nvx_generate_daily_control_centre_insights()`

The function is expected to persist `agent_outputs.agent_type = 'daily-insight'` records. The executable body was production-validated manually on 2026-08-24 before its first scheduled window.
