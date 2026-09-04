import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/update-wordpress-social-proof.yml';
const workflow = readFileSync(workflowPath, 'utf8');

describe('WordPress social-proof Production owner', () => {
  it('replaces the monolithic maintenance owner with one dedicated workflow', () => {
    expect(existsSync('.github/workflows/manual-maintenance.yml')).toBe(false);
    expect(workflow).toContain('name: Update WordPress Social Proof');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('group: wordpress-social-proof-production');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('requires explicit Production authorization on trusted current main', () => {
    expect(workflow).toContain('confirmation:');
    expect(workflow).toContain('test "$CONFIRMATION" = UPDATE');
    expect(workflow).toContain('name: Production');
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('git fetch --no-tags origin main');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"');
  });

  it('pins SSH host identity and never disables host-key verification', () => {
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('UserKnownHostsFile=~/.ssh/known_hosts');
    expect(workflow).toContain('BatchMode=yes');
    expect(workflow).not.toContain('StrictHostKeyChecking=no');
  });

  it('attempts all cache operations and accepts the public runtime after any attempted mutation', () => {
    const mutation = workflow.indexOf('wp option update nvx_doctoralia_social_proof_count');
    const cacheFlush = workflow.indexOf('wp cache flush');
    const sitegroundPurge = workflow.indexOf('wp sg purge');
    const acceptance = workflow.indexOf('node scripts/social-proof/nuvanx-social-proof-audit.mjs');
    expect(mutation).toBeGreaterThan(-1);
    expect(cacheFlush).toBeGreaterThan(mutation);
    expect(sitegroundPurge).toBeGreaterThan(cacheFlush);
    expect(acceptance).toBeGreaterThan(sitegroundPurge);
    expect(workflow).toContain('id: mutation');
    expect(workflow).toContain("status=0; /usr/local/bin/wp option update");
    expect(workflow).toContain("/usr/local/bin/wp cache flush || status=\\$?");
    expect(workflow).toContain("/usr/local/bin/wp sg purge || status=\\$?");
    expect(workflow).toContain("if: ${{ always() && steps.mutation.outcome != 'skipped' }}");
    expect(workflow).toContain('name: wordpress-social-proof-acceptance');
  });
});