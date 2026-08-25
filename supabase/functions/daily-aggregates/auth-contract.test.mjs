import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync('supabase/functions/daily-aggregates/index.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260825184500_harden_daily_aggregates_internal_auth.sql', 'utf8');
const healthCheck = readFileSync('scripts/health-check-nuvanx.ts', 'utf8');

describe('daily-aggregates dual auth contract', () => {
  it('authorizes before request body parsing and preserves both legitimate owners', () => {
    const serviceRoleCheck = index.indexOf('authorizedByServiceRole');
    const internalSecretCheck = index.indexOf('authorizedByInternalSecret');
    const bodyParse = index.indexOf('await req.json()');
    expect(serviceRoleCheck).toBeGreaterThan(-1);
    expect(internalSecretCheck).toBeGreaterThan(-1);
    expect(bodyParse).toBeGreaterThan(internalSecretCheck);
    expect(index).toContain("p_name: 'REVOPS_INTERNAL_SECRET'");
    expect(index).toContain("req.headers.get('x-nvx-internal-secret')");
    expect(index).toContain('if (!authorizedByServiceRole && internalSecretHeader)');
  });

  it('alters the existing scheduler in place instead of creating another owner', () => {
    expect(migration).toContain("jobname = 'fetch-meta-daily-insights'");
    expect(migration).toContain('cron.alter_job');
    expect(migration).toContain('REVOPS_INTERNAL_SECRET');
    expect(migration).not.toContain('cron.schedule(');
  });

  it('keeps the production health probe non-destructive by expecting the auth guard', () => {
    const dailyAggregatesBlock = healthCheck.slice(healthCheck.indexOf("name: 'Daily Aggregates'"));
    expect(dailyAggregatesBlock).toContain('expectedStatuses: [403]');
    expect(dailyAggregatesBlock).toContain('auth guard enforced without executing job');
    expect(dailyAggregatesBlock).not.toContain('Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`');
  });
});
