import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/cloudflare-rollback.yml', 'utf8');

describe('Cloudflare governed rollback owner', () => {
  it('requires explicit Production authorization and exact rollback identity', () => {
    expect(workflow).toContain("confirmation must equal ROLLBACK");
    expect(workflow).toContain('target_version_id must be an exact UUID');
    expect(workflow).toContain('expected_source_sha must be an exact lowercase Git SHA');
    expect(workflow).toContain('environment:');
    expect(workflow).toContain('name: Production');
    expect(workflow).toContain('group: cloudflare-frontend-production');
  });

  it('verifies Cloudflare version provenance before mutating Production', () => {
    const provenance = workflow.indexOf('Verify target version provenance before mutation');
    const rollback = workflow.indexOf('Roll back to exact verified version');
    expect(provenance).toBeGreaterThan(-1);
    expect(rollback).toBeGreaterThan(provenance);
    expect(workflow).toContain('wrangler versions view "$TARGET_VERSION_ID"');
    expect(workflow).toContain('Cloudflare target version does not carry the expected Git SHA provenance');
  });

  it('requires a real state transition and proves the requested version becomes active', () => {
    expect(workflow).toContain('Target version is already active; this run would not prove a rollback state transition');
    expect(workflow).toContain('wrangler rollback "$TARGET_VERSION_ID"');
    expect(workflow).toContain('Requested rollback version is not present in the current production deployment');
  });

  it('performs public runtime and security acceptance after rollback without claiming authenticated acceptance', () => {
    expect(workflow).toContain('Verify public runtime after rollback');
    expect(workflow).toContain('/__canonical_runtime_probe__');
    expect(workflow).toContain('X-Frame-Options: DENY');
    expect(workflow).toContain('Content-Security-Policy');
    expect(workflow).toContain('Authenticated acceptance: still required');
  });
});
