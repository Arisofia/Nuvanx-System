import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/cloudflare-rollback.yml', import.meta.url)),
  'utf8',
);

describe('Cloudflare governed rollback owner', () => {
  it('requires explicit Production authorization and exact rollback identity', () => {
    expect(workflow).toContain('environment:');
    expect(workflow).toContain('name: Production');
    expect(workflow).toContain('group: cloudflare-frontend-production');
    expect(workflow).toContain("confirmation must equal ROLLBACK");
    expect(workflow).toContain('target_version_id must be an exact UUID');
    expect(workflow).toContain('expected_source_sha must be an exact lowercase Git SHA');
  });

  it('keeps every authorization, identity, credential, main-lineage and state precondition before the mutation', () => {
    const mutation = workflow.indexOf('wrangler rollback "$TARGET_VERSION_ID"');
    expect(mutation).toBeGreaterThan(-1);

    const preMutationGuards = [
      "confirmation must equal ROLLBACK",
      'target_version_id must be an exact UUID',
      'expected_source_sha must be an exact lowercase Git SHA',
      'rollback reason is required',
      'Missing GitHub Secret: CLOUDFLARE_API_TOKEN',
      'Missing GitHub Secret: CLOUDFLARE_ACCOUNT_ID',
      'checked-out main is not current protected main',
      'expected source SHA is not present in repository history',
      'wrangler versions view "$TARGET_VERSION_ID"',
      'Cloudflare target version provenance does not exactly match the expected Git SHA',
      'wrangler deployments status',
      'Target version already serves 100% of production traffic; this run would not prove a rollback state transition',
    ];

    for (const guard of preMutationGuards) {
      const position = workflow.indexOf(guard);
      expect(position, `${guard} must exist`).toBeGreaterThan(-1);
      expect(position, `${guard} must precede rollback mutation`).toBeLessThan(mutation);
    }
  });

  it('binds target provenance to exact Wrangler version fields rather than recursive string presence', () => {
    expect(workflow).toContain("payload?.id !== target");
    expect(workflow).toContain("payload?.annotations?.['workers/tag']");
    expect(workflow).toContain("payload?.annotations?.['workers/message']");
    expect(workflow).toContain('tag !== expectedSha || message !== `git:${expectedSha}`');
  });

  it('uses the latest deployment traffic contract and proves the target becomes the sole 100% active version', () => {
    expect(workflow).toContain('payload?.versions');
    expect(workflow).toContain('normalized.length === 1');
    expect(workflow).toContain('normalized[0].versionId === target && normalized[0].percentage === 100');
    expect(workflow).toContain('versions.length !== 1');
    expect(workflow).toContain('activeVersion !== target || activePercentage !== 100');
    expect(workflow).toContain('Rollback did not converge Production to exactly one active Worker version');
  });

  it('mirrors the canonical public security-header boundary after rollback', () => {
    expect(workflow).toContain('Verify canonical public runtime and security after rollback');
    expect(workflow).toContain('/__canonical_runtime_probe__');
    expect(workflow).toContain('X-Frame-Options: DENY');
    expect(workflow).toContain('X-Content-Type-Options: nosniff');
    expect(workflow).toContain('Referrer-Policy');
    expect(workflow).toContain('governed Permissions-Policy');
    expect(workflow).toContain('Content-Security-Policy');
    expect(workflow).toContain('frame-ancestors');
    expect(workflow).toContain('connect.facebook.net');
    expect(workflow).toContain('Supabase HTTPS connections');
    expect(workflow).toContain('Supabase realtime connections');
    expect(workflow).toContain('Authenticated acceptance: still required');
  });
});
