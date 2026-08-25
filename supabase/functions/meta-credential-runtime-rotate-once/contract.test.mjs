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
    expect(source).toContain('metadata.canonical !== true');
    expect(source).not.toContain(".eq('service', 'meta')");
  });

  it('accepts the canonical token only through Authorization and keeps the App Secret inside Supabase runtime', () => {
    expect(source).toContain("req.headers.get('authorization')");
    expect(source).toContain("req.headers.get('x-nuvanx-operation')");
    expect(source).toContain("Deno.env.get('META_CANONICAL_APP_SECRET')");
    expect(source).toContain("Deno.env.get('META_REPORTING_APP_SECRET')");
    expect(source).not.toContain("req.headers.get('x-meta-app-secret')");
    expect(source).not.toContain("searchParams.get('token')");
    expect(source).not.toContain('token: token');
    expect(source).not.toContain('access_token: token');
    expect(workflow).not.toContain('META_CANONICAL_APP_SECRET: ${{ secrets.META_CANONICAL_APP_SECRET }}');
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
    expect(source).toContain("runtime_reencrypt: {");
    expect(source).toContain("state: 'COMPLETED'");
    expect(source).toContain('operation_marked_completed: true');
    expect(update).toBeGreaterThan(markerCheck);
    expect(source).toContain(".eq('service', 'meta_ads')");
    expect(source).not.toContain(".from('integrations')\n    .update(");
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
