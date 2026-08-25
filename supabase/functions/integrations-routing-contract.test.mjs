import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const legacyStandalonePath = 'supabase/functions/integrations/index.ts';
const apiSource = readFileSync('supabase/functions/api/index.ts', 'utf8');
const integrationsPage = readFileSync('frontend/src/pages/Integrations.tsx', 'utf8');

function frontendSources(dir = 'frontend/src') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...frontendSources(path));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function extractFunctionBody(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Function marker not found: ${marker}`);
  const openBrace = source.indexOf('{', markerIndex);
  if (openBrace < 0) throw new Error(`Function body not found: ${marker}`);

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }
  throw new Error(`Unclosed function body: ${marker}`);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => {
  const arr = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return arr;
};

describe('integrations credential ownership', () => {
  it('keeps the plaintext legacy standalone handler removed', () => {
    expect(existsSync(legacyStandalonePath)).toBe(false);
  });

  it('routes every frontend integration caller through the canonical API Edge Function', () => {
    expect(integrationsPage).toContain("invokeApi('/api/integrations')");
    expect(integrationsPage).toContain("invokeApi('/api/integrations/connect'");
    expect(integrationsPage).toContain("invokeApi('/api/integrations/test'");

    const forbidden = frontendSources()
      .filter((path) => readFileSync(path, 'utf8').includes('/functions/v1/integrations'));
    expect(forbidden).toEqual([]);
  });

  it('produces real ciphertext and persists only the encryptCred result', async () => {
    const encryptBody = extractFunctionBody(apiSource, 'async function encryptCred');
    const decryptBody = extractFunctionBody(apiSource, 'export async function decryptCred');
    const encrypt = new AsyncFunction('raw', 'ENCRYPTION_KEY', 'bytesToHex', encryptBody);
    const decrypt = new AsyncFunction('encoded', 'ENCRYPTION_KEY', 'hexToBytes', decryptBody);
    const masterKey = 'integration-contract-master-key-at-least-32-characters';
    const token = 'meta-secret-token-that-must-never-be-stored-plaintext';

    const encrypted = await encrypt(token, masterKey, bytesToHex);
    expect(encrypted).not.toBe(token);
    expect(encrypted).toMatch(/^[0-9a-f]{64}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    await expect(decrypt(encrypted, masterKey, hexToBytes)).resolves.toBe(token);

    const encryptionCall = apiSource.indexOf('const encryptedKey = await encryptCred(String(reqToken).trim())');
    const credentialWrite = apiSource.indexOf('encrypted_key: encryptedKey', encryptionCall);
    expect(encryptionCall).toBeGreaterThan(-1);
    expect(credentialWrite).toBeGreaterThan(encryptionCall);
    expect(apiSource).not.toContain('encrypted_key: apiKey');
    expect(apiSource).not.toContain('encrypted_key: reqToken');
  });
});
