import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const standalone = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const googleAdsAcceptance = readFileSync('.github/workflows/google-ads-runtime-acceptance.yml', 'utf8');
const hubspotMonitor = readFileSync('.github/workflows/hubspot-marketing-contact-monitor.yml', 'utf8');
const controlCentre = readFileSync('.github/workflows/control-centre-runtime.yml', 'utf8');
const master = readFileSync('.github/workflows/master.yml', 'utf8');

const ORDINARY_EDGE_LOCK = 'manual-maintenance-deploy_edge';

function jobBody(workflow, jobName) {
  const marker = `\n  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = start + marker.length;
  const nextJob = workflow.slice(bodyStart).search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJob < 0
    ? workflow.slice(bodyStart)
    : workflow.slice(bodyStart, bodyStart + nextJob);
}

describe('production Supabase mutation concurrency', () => {
  it('keeps one governed standalone Edge deployment owner for automatic and manual recovery runs', () => {
    expect(standalone).toContain("workflows: ['Master System']");
    expect(standalone).toContain('workflow_dispatch:');
    expect(standalone).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(standalone).toContain('cancel-in-progress: false');
    expect(standalone).toContain('environment:');
    expect(standalone).toContain('name: Production');
    expect(standalone).toContain('supabase functions deploy control-centre-provider');
    expect(standalone).toContain('supabase/functions/control-centre-provider/index.ts');
  });

  it('serializes downstream Google Ads acceptance with governed Edge mutations', () => {
    expect(googleAdsAcceptance).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(googleAdsAcceptance).toContain('cancel-in-progress: false');
    expect(googleAdsAcceptance).toContain('name: Production');
  });

  it('serializes the HubSpot Production monitor with every governed Edge mutation path', () => {
    expect(hubspotMonitor).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(hubspotMonitor).toContain('cancel-in-progress: false');
    expect(hubspotMonitor).not.toContain('group: hubspot-marketing-contact-monitor-production');
  });

  it('keeps Control Centre Runtime validation-only so a separate automatic deploy cannot be dropped', () => {
    expect(jobBody(controlCentre, 'validate')).toContain('Provider contract tests');
    expect(jobBody(controlCentre, 'deploy')).toBe('');
    expect(controlCentre).not.toContain('supabase functions deploy control-centre-provider');
  });

  it('keeps the Master Supabase fallback explicit/manual rather than an ordinary push mutator', () => {
    const fallbackJob = jobBody(master, 'deploy-supabase');
    expect(fallbackJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(fallbackJob).toContain("inputs.operation == 'deploy'");
    expect(fallbackJob).toContain('group: nuvanx-system-supabase-production');
    expect(fallbackJob).toContain('cancel-in-progress: false');
  });
});
