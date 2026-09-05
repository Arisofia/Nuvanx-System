import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');

function indexOfRequired(fragment) {
  const index = workflow.indexOf(fragment);
  expect(index, `missing workflow fragment: ${fragment}`).toBeGreaterThan(-1);
  return index;
}

describe('canonical Meta runtime secret ownership', () => {
  it('binds the canonical token and App Secret from protected GitHub secrets', () => {
    expect(workflow).toContain('META_CANONICAL_ACCESS_TOKEN: ${{ secrets.META_CANONICAL_ACCESS_TOKEN }}');
    expect(workflow).toContain('META_CANONICAL_APP_SECRET: ${{ secrets.META_CANONICAL_APP_SECRET }}');
    expect(workflow).toContain('test -n "${META_CANONICAL_ACCESS_TOKEN:-}"');
    expect(workflow).toContain('test -n "${META_CANONICAL_APP_SECRET:-}"');
  });

  it('validates the exact Meta App, System User and lead retrieval scopes before any Production mutation', () => {
    const preflight = indexOfRequired('Validate canonical Meta credential identity');
    const mutationGuard = indexOfRequired('Reverify remote main immediately before Production mutation');
    expect(preflight).toBeLessThan(mutationGuard);
    expect(workflow).toContain("'https://graph.facebook.com/v22.0/debug_token'");
    expect(workflow).toContain('app_access_token="1836302544001572|${META_CANONICAL_APP_SECRET}"');
    expect(workflow).toContain('(.data.app_id | tostring) == "1836302544001572"');
    expect(workflow).toContain('(.data.user_id | tostring) == "122098243371455164"');
    expect(workflow).toContain('index("leads_retrieval")');
    expect(workflow).toContain('index("pages_show_list")');
    expect(workflow).toContain('META_CANONICAL_CREDENTIAL_PREFLIGHT=PASS');
  });

  it('promotes only the validated App Secret into Supabase Edge runtime after the exact-SHA mutation guard', () => {
    const mutationGuard = indexOfRequired('Reverify remote main immediately before Production mutation');
    const sync = indexOfRequired('META_CANONICAL_APP_SECRET="$META_CANONICAL_APP_SECRET"');
    const firstDeploy = indexOfRequired('supabase functions deploy api --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(sync).toBeGreaterThan(mutationGuard);
    expect(sync).toBeLessThan(firstDeploy);
    expect(workflow).not.toContain('META_CANONICAL_ACCESS_TOKEN="$META_CANONICAL_ACCESS_TOKEN"');
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
