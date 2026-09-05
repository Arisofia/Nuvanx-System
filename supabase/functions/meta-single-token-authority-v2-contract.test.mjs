import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const migration = readFileSync('supabase/migrations/20260905201500_add_meta_runtime_credential_acceptance_dispatcher.sql', 'utf8');

describe('Meta single-token authority V2 deployment contract', () => {
  it('removes the stale GitHub management token from the governed owner', () => {
    expect(workflow).not.toContain('META_CANONICAL_ACCESS_TOKEN');
    expect(workflow).toContain('META_CANONICAL_APP_SECRET: ${{ secrets.META_CANONICAL_APP_SECRET }}');
  });

  it('Deno-validates and deploys runtime credential acceptance with the internal boundary policy', () => {
    expect(workflow).toContain('supabase/functions/meta-runtime-credential-acceptance/index.ts');
    expect(workflow).toContain('supabase functions deploy meta-runtime-credential-acceptance --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });

  it('waits for the uniquely versioned dispatcher migration before any Edge mutation', () => {
    const migrationGate = workflow.indexOf('Wait for automatic Production migration owner');
    const mutationGuard = workflow.indexOf('Reverify remote main immediately before Production mutation');
    expect(migrationGate).toBeGreaterThan(-1);
    expect(migrationGate).toBeLessThan(mutationGuard);
    expect(migration).toContain('public.nvx_dispatch_meta_runtime_credential_acceptance()');
    expect(migration).toContain("WHERE name = 'REVOPS_INTERNAL_SECRET'");
  });

  it('fails the deployment if the live Supabase token + App Secret pair cannot prove canonical identity', () => {
    const deploy = workflow.indexOf('supabase functions deploy meta-runtime-credential-acceptance');
    const acceptance = workflow.indexOf('Validate canonical Meta runtime credential');
    expect(deploy).toBeGreaterThan(-1);
    expect(acceptance).toBeGreaterThan(deploy);
    expect(workflow).toContain('nvx_dispatch_meta_runtime_credential_acceptance');
    expect(workflow).toContain('META_CANONICAL_RUNTIME_ACCEPTANCE=PASS');
    expect(workflow).toContain('(.appId | tostring) == "1836302544001572"');
    expect(workflow).toContain('(.systemUserId | tostring) == "122098243371455164"');
    expect(workflow).toContain('(.pageId | tostring) == "113908631183569"');
  });
});