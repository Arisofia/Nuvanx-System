import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260513150000_schedule_meta_daily_insights.sql';
const masterPath = '.github/workflows/master.yml';
const migration = readFileSync(migrationPath, 'utf8');
const master = readFileSync(masterPath, 'utf8');
const aggregates = readFileSync('supabase/functions/daily-aggregates/index.ts', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const ownership = readFileSync('docs/operations/daily-automation-ownership.md', 'utf8');

function walkFiles(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function scheduledMetaOwnerFiles() {
  const roots = ['.github/workflows', 'supabase/migrations'];
  return roots
    .flatMap(walkFiles)
    .filter((path) => /\.(?:ya?ml|sql)$/.test(path))
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('fetch_meta_insights')
        && (
          source.includes('cron.schedule')
          || source.includes('schedule:')
          || source.includes('workflow_dispatch:')
        );
    })
    .sort();
}

describe('daily automation ownership', () => {
  it('is executed by the normal backend CI gate', () => {
    expect(packageJson.scripts.test).toContain('vitest run supabase/functions');
  });

  it('keeps Supabase pg_cron as the 05:00 UTC primary Meta ingestion owner', () => {
    expect(migration).toContain("'fetch-meta-daily-insights'");
    expect(migration).toContain("'0 5 * * *'");
    expect(migration).toContain("'action', 'fetch_meta_insights'");
    expect(migration).toContain("'days', 2");
    expect(ownership).toContain('Primary ingestion — Supabase pg_cron');
  });

  it('keeps GitHub at 07:00 UTC as the explicit reconciliation owner with a real date range', () => {
    expect(master).toContain("- cron: '0 7 * * *'");
    expect(master).toContain('"action":"fetch_meta_insights"');
    expect(master).toContain('"from":"${from_date}"');
    expect(master).toContain('"to":"${to_date}"');
    expect(aggregates).toContain('type DailyAggregatesRequest = MetaDateRangeInput &');
    expect(aggregates).toContain('resolveMetaDateRange(input)');
    expect(ownership).toContain('Reconciliation/backfill — GitHub Master System');
  });

  it('allows exactly the canonical pg_cron and Master System scheduled Meta writers', () => {
    expect(scheduledMetaOwnerFiles()).toEqual([masterPath, migrationPath].sort());
  });

  it('keeps both runs idempotent on the canonical daily fact key', () => {
    expect(aggregates).toContain(".from('meta_daily_insights').upsert(rows, { onConflict: 'clinic_id,ad_account_id,date' })");
  });

  it('loads both legacy and canonical Meta credentials without querying a nonexistent deleted_at column', () => {
    expect(aggregates).toContain(".in('service', ['meta', 'meta_ads'])");
    expect(aggregates).not.toContain(".is('deleted_at', null)");
    expect(aggregates).toContain("service === 'meta_ads' ? META_CANONICAL_APP_SECRET : META_APP_SECRET");
  });

  it('documents the Control Centre insight job as a distinct downstream owner', () => {
    expect(ownership).toContain('nvx-control-centre-daily-insight');
    expect(ownership).toContain('public.nvx_generate_daily_control_centre_insights()');
  });
});
