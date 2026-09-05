import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hygiene = readFileSync('scripts/validate-repository-hygiene.mjs', 'utf8');
const runtimeAudit = readFileSync('scripts/social-proof/nuvanx-social-proof-audit.mjs', 'utf8');
const retiredWordPressOwners = [
  '.github/workflows/manual-maintenance.yml',
  '.github/workflows/update-wordpress-social-proof.yml',
  'scripts/social-proof/doctoralia-public-snapshot.mjs',
  'wp-mu-plugins/nuvanx-doctoralia-social-proof.php',
  'wp-mu-plugins/nuvanx-doctoralia-price-barrio-salamanca.php',
  'wp-mu-plugins/nuvanx-google-review-request-v2.php',
  'docs/social-proof/doctoralia-google-meta-activation-plan.md',
  'docs/local-seo/google-business-profile-review-activation.md',
];

describe('retired WordPress injection owners', () => {
  it('keeps non-runtime WordPress mutators and injection owners absent', () => {
    for (const retiredPath of retiredWordPressOwners) {
      expect(existsSync(retiredPath), retiredPath).toBe(false);
    }
  });

  it('locks every retirement into repository hygiene', () => {
    for (const retiredPath of retiredWordPressOwners) {
      expect(hygiene, retiredPath).toContain(`'${retiredPath}'`);
    }
  });

  it('does not require a GitHub WordPress mutation owner after the runtime was proven absent', () => {
    expect(hygiene).not.toMatch(/requiredProductionPaths[\s\S]*update-wordpress-social-proof\.yml/);
  });

  it('keeps the scheduled public audit focused on detecting retired runtime injection', () => {
    expect(runtimeAudit).toContain("contract: 'retired-wordpress-injection-owners'");
    expect(runtimeAudit).toContain('retiredRuntimeMarkers');
    expect(runtimeAudit).toContain('noRetiredWordPressInjection');
    expect(runtimeAudit).not.toContain('EXPECTED_DOCTORALIA_COUNT');
    expect(runtimeAudit).not.toMatch(/\b98\b/);
  });
});
