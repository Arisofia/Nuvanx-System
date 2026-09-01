import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const standalone = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const maintenance = readFileSync('.github/workflows/manual-maintenance.yml', 'utf8');
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
  it('serializes the canonical standalone Edge deployment with manual deploy_edge', () => {
    expect(standalone).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(standalone).toContain('cancel-in-progress: false');
    expect(maintenance).toContain('- deploy_edge');
    expect(maintenance).toContain('group: manual-maintenance-${{ inputs.operation }}');
  });

  it('serializes the automatic Control Centre provider deploy on the same lock', () => {
    const deployJob = jobBody(controlCentre, 'deploy');
    expect(deployJob).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(deployJob).toContain('cancel-in-progress: false');
    expect(deployJob).toContain('supabase functions deploy control-centre-provider');
  });

  it('keeps the Master Supabase fallback explicit/manual rather than an ordinary push mutator', () => {
    const fallbackJob = jobBody(master, 'deploy-supabase');
    expect(fallbackJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(fallbackJob).toContain("inputs.operation == 'deploy'");
    expect(fallbackJob).toContain('group: nuvanx-system-supabase-production');
    expect(fallbackJob).toContain('cancel-in-progress: false');
  });
});
