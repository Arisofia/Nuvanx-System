import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/meta-credential-runtime-rotate-once/index.ts', 'utf8');

describe('canonical Meta runtime credential rotation contract', () => {
  it('is hard-bound to the canonical NUVANX Meta asset stack', () => {
    expect(source).toContain("const EXPECTED_SYSTEM_USER_ID = '122098243371455164'");
    expect(source).toContain("const EXPECTED_AD_ACCOUNT_ID = 'act_718120894191565'");
    expect(source).toContain("const EXPECTED_APP_ID = '1836302544001572'");
    expect(source).toContain(".eq('service', 'meta_ads')");
    expect(source).toContain('metadata.canonical !== true');
    expect(source).not.toContain(".eq('service', 'meta')");
  });

  it('accepts the canonical token only through an Authorization header and never returns it', () => {
    expect(source).toContain("req.headers.get('authorization')");
    expect(source).toContain("req.headers.get('x-nuvanx-operation')");
    expect(source).not.toContain("searchParams.get('token')");
    expect(source).not.toContain('token: token');
    expect(source).not.toContain('access_token: token');
  });

  it('validates Meta identity before encrypting with the runtime key and writes only the canonical credential', () => {
    const graphValidation = source.indexOf("me = await graph('/me', token, appSecret)");
    const encrypt = source.indexOf('const encrypted = await encryptCredential(token, encryptionKey)');
    const update = source.indexOf(".update({ encrypted_key: encrypted, last_used: new Date().toISOString() })");
    expect(graphValidation).toBeGreaterThan(-1);
    expect(encrypt).toBeGreaterThan(graphValidation);
    expect(update).toBeGreaterThan(encrypt);
    expect(source).toContain('const roundTrip = await decryptCredential(encrypted, encryptionKey)');
    expect(source).toContain(".eq('service', 'meta_ads')");
  });
});
