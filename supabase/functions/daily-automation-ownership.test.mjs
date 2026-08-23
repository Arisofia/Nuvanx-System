import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260513150000_schedule_meta_daily_insights.sql', 'utf8');
const master = readFileSync('.github/workflows/master.yml', 'utf8');
const aggregates = readFileSync('supabase/functions/daily-aggregates/index.ts', 'utf8');
const ownership = readFileSync('docs/operations/daily-automation-ownership.md', 'utf8');

describe('daily automation ownership', () => {
  it('keeps Supabase pg_cron as the 05:00 UTC primary Meta ingestion owner', () => {
    expect(migration).toContain("'fetch-meta-daily-insights'");
    expect(migration).toContain("'0 5 * * *'");
    expect(migration).toContain("'action', 'fetch_meta_insights'");
    expect(migration).toContain("'days', 2");
    expect(ownership).toContain('Primary ingestion — Supabase pg_cron');
  });

  it('keeps GitHub at 07:00 UTC as the reconciliation/backfill owner', () => {
    expect(master).toContain("- cron: '0 7 * * *'");
    expect(master).toContain('fetch_meta_insights');
    expect(ownership).toContain('Reconciliation/backfill — GitHub Master System');
  });

  it('keeps both runs idempotent on the canonical daily fact key', () => {
    expect(aggregates).toContain(".from('meta_daily_insights').upsert(rows, { onConflict: 'clinic_id,ad_account_id,date' })");
    expect(ownership).toContain('Do not add a third Meta daily owner');
  });

  it('documents the Control Centre insight job as a distinct downstream owner', () => {
    expect(ownership).toContain('nvx-control-centre-daily-insight');
    expect(ownership).toContain('public.nvx_generate_daily_control_centre_insights()');
  });
});
