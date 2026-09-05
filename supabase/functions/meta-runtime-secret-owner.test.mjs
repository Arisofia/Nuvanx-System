import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const acceptance = readFileSync('supabase/functions/meta-runtime-credential-acceptance/index.ts', 'utf8');
const dispatcher = readFileSync('supabase/migrations/20260905201500_add_meta_runtime_credential_acceptance_dispatcher.sql', 'utf8');

function indexOfRequired(fragment) {
  const index = workflow.indexOf(fragment);
  expect(index, `missing workflow fragment: ${fragment}`).toBeGreaterThan(-1);
  return index;
}

describe('canonical Meta runtime secret ownership', () => {
  it('keeps GitHub as App Secret authority only and removes the duplicate management token authority', () => {
    expect(workflow).toContain('META_CANONICAL_APP_SECRET: ${{ secrets.META_CANONICAL_APP_SECRET }}');
    expect(workflow).toContain('test -n "${META_CANONICAL_APP_SECRET:-}"');
    expect(workflow).not.toContain('META_CANONICAL_ACCESS_TOKEN');
    expect(workflow).not.toContain('META_REPORTING_APP_SECRET');
    expect(acceptance).not.toContain('META_CANONICAL_ACCESS_TOKEN');
    expect(acceptance).not.toContain('META_REPORTING_APP_SECRET');
    expect(acceptance).toContain('.eq("service", "meta_ads")');
    expect(acceptance).toContain('decryptCred(String(credential.encrypted_key))');
  });

  it('validates the App Secret identity before any Production mutation', () => {
    const preflight = indexOfRequired('Validate canonical Meta App Secret identity');
    const mutationGuard = indexOfRequired('Reverify remote main immediately before Production mutation');
    expect(preflight).toBeLessThan(mutationGuard);
    expect(workflow).toContain('app_access_token="1836302544001572|${META_CANONICAL_APP_SECRET}"');
    expect(workflow).toContain("'https://graph.facebook.com/v22.0/1836302544001572'");
    expect(workflow).toContain('META_CANONICAL_APP_SECRET_PREFLIGHT=PASS app_id=1836302544001572');
  });

  it('promotes only the validated App Secret and deploys the runtime acceptance function after the exact-SHA mutation guard', () => {
    const mutationGuard = indexOfRequired('Reverify remote main immediately before Production mutation');
    const sync = indexOfRequired('META_CANONICAL_APP_SECRET="$META_CANONICAL_APP_SECRET"');
    const acceptanceDeploy = indexOfRequired('supabase functions deploy meta-runtime-credential-acceptance --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(sync).toBeGreaterThan(mutationGuard);
    expect(acceptanceDeploy).toBeGreaterThan(sync);
    expect(workflow).not.toContain('META_CANONICAL_ACCESS_TOKEN="$META_CANONICAL_ACCESS_TOKEN"');
  });

  it('proves the combined App Secret + Supabase meta_ads token live before the governed deployment can pass', () => {
    const deploy = indexOfRequired('supabase functions deploy meta-runtime-credential-acceptance --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    const runtimeAcceptance = indexOfRequired('Validate canonical Meta runtime credential');
    expect(runtimeAcceptance).toBeGreaterThan(deploy);
    expect(workflow).toContain('nvx_dispatch_meta_runtime_credential_acceptance');
    expect(workflow).toContain('META_CANONICAL_RUNTIME_ACCEPTANCE=PASS');
    expect(workflow).toContain('.credential_owner == "supabase_meta_ads"');
    expect(workflow).toContain('(.appId | tostring) == "1836302544001572"');
    expect(workflow).toContain('(.systemUserId | tostring) == "122098243371455164"');
    expect(workflow).toContain('(.pageId | tostring) == "113908631183569"');
    expect(dispatcher).toContain("WHERE name = 'REVOPS_INTERNAL_SECRET'");
    expect(dispatcher).toContain("WHERE name = 'REVOPS_PROJECT_URL'");
    expect(dispatcher).toContain('GRANT EXECUTE ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() TO service_role');
  });

  it('keeps both sides of the Meta CAPI relay under the same governed owner and preserves JWT policy', () => {
    const denoWebEvents = indexOfRequired('supabase/functions/web-events/index.ts');
    const denoDispatch = indexOfRequired('supabase/functions/meta-capi-dispatch/index.ts');
    expect(denoWebEvents).toBeLessThan(denoDispatch);

    const deployWebEvents = indexOfRequired('supabase functions deploy web-events --project-ref "$SUPABASE_PROJECT_REF"');
    const deployDispatch = indexOfRequired('supabase functions deploy meta-capi-dispatch --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(deployWebEvents).toBeLessThan(deployDispatch);
    expect(workflow).not.toContain('supabase functions deploy web-events --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});