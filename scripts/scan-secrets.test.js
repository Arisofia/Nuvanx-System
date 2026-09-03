'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findPrivateKeyMaterial,
  isLocalPostgresHarnessLine,
  scanText,
  scanTrackedFiles,
} = require('./scan-secrets');

function patterns(findings) {
  return findings.map((finding) => finding.pattern);
}

test('local Postgres harness credential is accepted but remote inline credentials remain blocked', () => {
  const local = 'DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/nuvanx_invariant';
  assert.equal(isLocalPostgresHarnessLine(local), true);
  assert.deepEqual(scanText('.github/workflows/local-postgres.yml', local), []);

  const remotePassword = 'remote' + 'Credential' + '987654321';
  const remote = `DATABASE_URL=postgresql://postgres:${remotePassword}@db.example.supabase.co:5432/postgres`;
  assert.ok(patterns(scanText('scripts/runtime.js', remote)).includes('Postgres URL with inline password'));
});

test('private-key syntax mentions and the explicit tiny test fixture are not treated as private key material', () => {
  const syntaxMention = "if (value.includes('-----BEGIN PRIVATE KEY-----')) return true;";
  assert.equal(findPrivateKeyMaterial(syntaxMention), null);

  const tinyFixture = [
    "private_key: '-----BEGIN PRIVATE KEY-----\\n",
    "test\\n",
    "-----END PRIVATE KEY-----'",
  ].join('');
  assert.equal(findPrivateKeyMaterial(tinyFixture), null);
});

test('a plausible embedded private-key block is still blocked', () => {
  const body = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo' + 'A'.repeat(96);
  const pem = ['-----BEGIN PRIVATE KEY-----', body, '-----END PRIVATE KEY-----'].join('\n');
  const findings = scanText('config/runtime.txt', pem);
  assert.ok(patterns(findings).includes('Private key block'));
});

test('explicit synthetic test credentials are accepted without exempting the test file', () => {
  const source = [
    "const GOOGLE_ADS_CLIENT_SECRET = 'client-secret-for-contract-testing';",
    "const GOOGLE_ADS_REFRESH_TOKEN = 'refresh-token-for-contract-testing';",
    "const SUPABASE_SERVICE_ROLE = 'service-role-value-for-contract-testing';",
  ].join('\n');
  assert.deepEqual(scanText('scripts/example.test.js', source), []);
});

test('a high-entropy hardcoded secret remains blocked even inside a test file', () => {
  const highEntropy = ['z9Qx', '4LmN', '7VpR', '2KsT', '8WdF', '6JcH', '3ByE', '5UaG'].join('');
  const source = `const API_KEY = '${highEntropy}';`;
  const findings = scanText('scripts/security.test.js', source);
  assert.ok(patterns(findings).includes('Hardcoded secret assignment'));
});

test('AWS access keys remain blocked in all contexts', () => {
  const awsKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
  const findings = scanText('scripts/security.test.js', `const candidate = '${awsKey}';`);
  assert.ok(patterns(findings).includes('AWS access key'));
});

test('the current tracked repository passes the same scanner used by Daily Sync', () => {
  const result = scanTrackedFiles();
  assert.deepEqual(result.findings, []);
  assert.ok(result.scanned > 0);
});
