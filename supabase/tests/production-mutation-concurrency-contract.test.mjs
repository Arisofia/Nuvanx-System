import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const standalone = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const maintenance = readFileSync('.github/workflows/manual-maintenance.yml', 'utf8');
const controlCentre = readFileSync('.github/workflows/control-centre-runtime.yml', 'utf8');
const master = readFileSync('.github/workflows/master.yml', 'utf8');

const ORDINARY_EDGE_LOCK = 'manual-maintenance-deploy_edge';

describe('production Supabase mutation concurrency', () => {
  it('serializes the canonical standalone Edge deployment with manual deploy_edge', () => {
    expect(standalone).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(standalone).toContain('cancel-in-progress: false');
    expect(maintenance).toContain('- deploy_edge');
    expect(maintenance).toContain('group: manual-maintenance-${{ inputs.operation }}');
  });

  it('serializes the automatic Control Centre provider deploy on the same lock', () => {
    const deployJob = controlCentre.split('\n  deploy:\n')[1] || '';
    expect(deployJob).toContain(`group: ${ORDINARY_EDGE_LOCK}`);
    expect(deployJob).toContain('cancel-in-progress: false');
    expect(deployJob).toContain('supabase functions deploy control-centre-provider');
  });

  it('keeps the Master Supabase fallback explicit/manual rather than an ordinary push mutator', () => {
    expect(master).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(master).toContain('group: nuvanx-system-supabase-production');
    expect(master).toContain('cancel-in-progress: false');
  });
});
