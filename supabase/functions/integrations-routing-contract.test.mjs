import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const legacyStandalonePath = 'supabase/functions/integrations/index.ts';
const apiSource = readFileSync('supabase/functions/api/index.ts', 'utf8');
const integrationsPage = readFileSync('frontend/src/pages/Integrations.tsx', 'utf8');

describe('integrations credential ownership', () => {
  it('keeps the plaintext legacy standalone handler removed', () => {
    expect(existsSync(legacyStandalonePath)).toBe(false);
  });

  it('routes frontend integration writes through the canonical API Edge Function', () => {
    expect(integrationsPage).toContain("invokeApi('/api/integrations')");
    expect(integrationsPage).toContain("invokeApi('/api/integrations/connect'");
    expect(integrationsPage).toContain("invokeApi('/api/integrations/test'");
    expect(integrationsPage).not.toContain('/functions/v1/integrations');
  });

  it('encrypts credentials before the canonical API writes encrypted_key', () => {
    const encryptionCall = apiSource.indexOf('const encryptedKey = await encryptCred(String(reqToken).trim())');
    const credentialWrite = apiSource.indexOf('encrypted_key: encryptedKey', encryptionCall);

    expect(encryptionCall).toBeGreaterThan(-1);
    expect(credentialWrite).toBeGreaterThan(encryptionCall);
    expect(apiSource).not.toContain('encrypted_key: apiKey');
  });
});
