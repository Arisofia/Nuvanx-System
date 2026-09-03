'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findPrivateKeyMaterial,
  isDynamicSecretReference,
  isHumanReadableDiagnostic,
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
  assert.deepEqual(scanText('scripts/private-key.test.js', tinyFixture), []);
});

test('a plausible embedded private-key block is still blocked', () => {
  const body = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo' + 'A'.repeat(96);
  const pem = ['-----BEGIN PRIVATE KEY-----', body, '-----END PRIVATE KEY-----'].join('\n');
  const findings = scanText('config/runtime.txt', pem);
  assert.ok(patterns(findings).includes('Private key block'));
});

test('dynamic secret references remain scannable without being treated as embedded values', () => {
  assert.equal(isDynamicSecretReference('${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}'), true);
  assert.equal(isDynamicSecretReference('$INPUT_SUPABASE_DB_PASSWORD'), true);
  assert.equal(isDynamicSecretReference('$(openssl rand -hex 32)'), true);
  assert.equal(isDynamicSecretReference('env(S3_SECRET_KEY)'), true);

  const source = [
    'SUPABASE_SERVICE_ROLE_KEY: "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"',
    'PASSWORD="$INPUT_SUPABASE_DB_PASSWORD"',
    'PASSWORD="$(openssl rand -hex 32)"',
    's3_secret_key = "env(S3_SECRET_KEY)"',
  ].join('\n');
  assert.deepEqual(scanText('.github/workflows/runtime.yml', source), []);
});

test('only explicit diagnostic identifiers may carry human-readable diagnostic messages', () => {
  const message = 'Missing required GitHub secret/env var: META_ACCESS_TOKEN.';
  assert.equal(isHumanReadableDiagnostic('MISSING_ACCESS_TOKEN', message), true);
  assert.equal(isHumanReadableDiagnostic('PASSWORD', 'this is a long real password phrase'), false);
  assert.deepEqual(scanText('scripts/runtime.js', `MISSING_ACCESS_TOKEN: '${message}'`), []);

  const findings = scanText('scripts/runtime.js', "PASSWORD='this is a long real password phrase'");
  assert.ok(patterns(findings).includes('Hardcoded secret assignment'));
});

test('explicit synthetic test credentials are accepted without exempting the test file', () => {
  const source = [
    "const GOOGLE_ADS_CLIENT_SECRET = 'client-secret-for-contract-testing';",
    "const GOOGLE_ADS_REFRESH_TOKEN = 'refresh-token-for-contract-testing';",
    "const SUPABASE_SERVICE_ROLE = 'service-role-value-for-contract-testing';",
    "const SECRET = 'credential-material-must-not-leak';",
    "const TOKEN = 'super-secret-value-that-must-not-appear';",
    "const secret = 'sensitive-stage-value';",
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
