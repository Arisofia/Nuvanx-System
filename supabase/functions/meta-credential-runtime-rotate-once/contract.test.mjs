import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/meta-credential-runtime-rotate-once/index.ts', 'utf8');
const workflow = readFileSync('.github/workflows/meta-runtime-credential-reencrypt.yml', 'utf8');

describe('canonical Meta runtime credential rotation contract', () => {
  it('is hard-bound to the canonical NUVANX Meta asset stack', () => {
    expect(source).toContain("const EXPECTED_SYSTEM_USER_ID = '122098243371455164'");
    expect(source).toContain("const EXPECTED_AD_ACCOUNT_ID = 'act_718120894191565'");
    expect(source).toContain("const EXPECTED_APP_ID = '1836302544001572'");
    expect(source).toContain(".eq('service', 'meta_ads')");
    expect(source).toContain('metadata.canonical === true');
    expect(source).not.toContain(".eq('service', 'meta')");
  });

  it('selects exactly one canonical meta_ads integration instead of assuming service-level uniqueness', () => {
    const integrationStart = source.indexOf('const { data: integrations, error: integrationError }');
    const credentialStart = source.indexOf('const { data: credential, error: credentialError }');
    const integrationSelection = source.slice(integrationStart, credentialStart);
    expect(integrationStart).toBeGreaterThan(-1);
    expect(credentialStart).toBeGreaterThan(integrationStart);
    expect(integrationSelection).toContain(".eq('service', 'meta_ads')");
    expect(integrationSelection).toContain('(integrations ?? []).filter(canonicalIntegrationMatches)');
    expect(integrationSelection).toContain('canonicalIntegrations.length !== 1');
    expect(integrationSelection).not.toContain('.maybeSingle()');
  });

  it('validates the GitHub App Secret against canonical Meta identity before promoting it to shared Supabase runtime', () => {
    const preflight = workflow.indexOf('Validate canonical App Secret before runtime promotion');
    const claim = workflow.indexOf('Acquire persistent retry-safe claim');
    const sync = workflow.indexOf('Sync validated canonical Meta App Secret into Supabase runtime');
    expect(preflight).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(preflight);
    expect(sync).toBeGreaterThan(claim);
    expect(workflow).toContain("'https://graph.facebook.com/v22.0/debug_token'");
    expect(workflow).toContain('app_access_token="1836302544001572|${META_CANONICAL_APP_SECRET}"');
    expect(workflow).toContain('.data.is_valid == true');
    expect(workflow).toContain('(.data.app_id | tostring) == "1836302544001572"');
    expect(workflow).toContain('(.data.user_id | tostring) == "122098243371455164"');
    expect(workflow).toContain('META_RUNTIME_APP_SECRET_PREFLIGHT=PASS');
  });

  it('keeps the App Secret in managed secret stores and never transports it to the rotator request', () => {
    expect(source).toContain("req.headers.get('authorization')");
    expect(source).toContain("req.headers.get('x-nuvanx-operation')");
    expect(source).toContain("Deno.env.get('META_CANONICAL_APP_SECRET')");
    expect(source).toContain("Deno.env.get('META_REPORTING_APP_SECRET')");
    expect(source).not.toContain("req.headers.get('x-meta-app-secret')");
    expect(source).not.toContain("searchParams.get('token')");
    expect(source).not.toContain('token: token');
    expect(source).not.toContain('access_token: token');
    expect(workflow).toContain('META_CANONICAL_APP_SECRET: ${{ secrets.META_CANONICAL_APP_SECRET }}');
    expect(workflow).toContain('test -n "${META_CANONICAL_APP_SECRET:-}"');
    expect(workflow).toContain('supabase secrets set \\\n            --project-ref "$SUPABASE_PROJECT_REF" \\\n            META_CANONICAL_APP_SECRET="$META_CANONICAL_APP_SECRET"');
    expect(workflow).not.toContain('--header "x-meta-app-secret:');
  });

  it('requires a fresh request and validates App, System User and Ad Account before encryption', () => {
    const debugValidation = source.indexOf('debug = await debugToken(token, appSecret)');
    const graphValidation = source.indexOf("me = await graph('/me', token, appSecret)");
    const encrypt = source.indexOf('encrypted = await encryptCredential(token, encryptionKey)');
    expect(source).toContain('const MAX_REQUEST_AGE_MS = 5 * 60 * 1000');
    expect(source).toContain("req.headers.get('x-nuvanx-issued-at')");
    expect(source).toContain("String(debug?.app_id ?? '') !== EXPECTED_APP_ID");
    expect(source).toContain("String(debug?.user_id ?? '') !== EXPECTED_SYSTEM_USER_ID");
    expect(source).toContain("if (!/^(?:act_)?\\d+$/i.test(value)) return ''");
    expect(debugValidation).toBeGreaterThan(-1);
    expect(graphValidation).toBeGreaterThan(debugValidation);
    expect(encrypt).toBeGreaterThan(graphValidation);
  });

  it('persists an internal completed marker in the same bounded credential update', () => {
    const markerCheck = source.indexOf("previousMarker.state === 'COMPLETED'");
    const update = source.indexOf(".update({\n      encrypted_key: encrypted,");
    expect(markerCheck).toBeGreaterThan(-1);
    expect(source).toContain('runtime_reencrypt: {');
    expect(source).toContain("state: 'COMPLETED'");
    expect(source).toContain('operation_marked_completed: true');
    expect(update).toBeGreaterThan(markerCheck);
    expect(source).toContain(".eq('service', 'meta_ads')");
    expect(source).not.toContain(".from('integrations')\n    .update(");
  });

  it('treats workflow_dispatch trusted_sha as data rather than shell source', () => {
    expect(workflow).toContain('TRUSTED_SHA: ${{ inputs.trusted_sha }}');
    expect(workflow).toContain('test "$TRUSTED_SHA" = "$GITHUB_SHA"');
    expect(workflow).not.toContain('test "${{ inputs.trusted_sha }}"');
  });

  it('makes GitHub claim state retry-safe and deletes the temporary Edge Function on every deployed run', () => {
    expect(workflow).toContain('state: RETRYABLE');
    expect(workflow).toContain('state: MUTATED');
    expect(workflow).toContain('state: COMPLETED');
    expect(workflow).toContain("steps.rotate.outputs.remote_state != 'operation_already_completed'");
    expect(workflow).toContain("if: ${{ always() && steps.deploy.outcome == 'success' }}");
    expect(workflow).toContain('supabase functions delete meta-credential-runtime-rotate-once');
    expect(workflow).toContain('--yes');
    expect(workflow).toContain("x-nuvanx-issued-at: ${issued_at}");
  });
});
