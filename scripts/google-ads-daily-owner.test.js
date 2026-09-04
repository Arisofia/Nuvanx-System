'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const test = require('node:test');

const orchestrator = readFileSync('scripts/run-daily-sync.js', 'utf8');
const edgeInvoker = readFileSync('scripts/sync-google-ads-via-edge.js', 'utf8');
const validator = readFileSync('scripts/validate-daily-sync-config.js', 'utf8');
const edgeWorker = readFileSync('supabase/functions/google-ads-daily-sync/index.ts', 'utf8');
const edgeDispatcher = readFileSync('supabase/functions/google-ads-backfill-dispatcher/index.ts', 'utf8');
const masterWorkflow = readFileSync('.github/workflows/master.yml', 'utf8');
const standaloneWorkflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');

function validDailySyncEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ACCESS_TOKEN: 'sbp_TestToken123',
    SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
    DATABASE_URL: 'postgresql://postgres:password@example.supabase.co:5432/postgres',
    META_ACCESS_TOKEN: 'meta-read-token',
    META_AD_ACCOUNT_IDS: '123456789',
    CLINIC_ID: '00000000-0000-4000-8000-000000000001',
    DOCTORALIA_SHEET_ID: 'doctoralia-sheet',
    DOCTORALIA_DRIVE_FILE_ID: 'doctoralia-sheet',
    DOCTORALIA_APPOINTMENTS_SHEET_ID: 'doctoralia-sheet',
    DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Doctoralia',
    DOCTORALIA_APPOINTMENTS_MIN_ROWS: '1800',
    DOCTORALIA_SYNC_PERMISSION_MODE: 'fail',
    DOCTORALIA_APPOINTMENTS_PERMISSION_MODE: 'fail',
    ENCRYPTION_KEY: 'test-encryption-key',
    REPORT_USER_ID: '00000000-0000-4000-8000-000000000002',
    GOOGLE_DOCTORALIA_SERVICE_ACCOUNT: JSON.stringify({
      client_email: 'daily-sync@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    }),
    ...overrides,
  };
}

function runValidator(env) {
  return spawnSync(process.execPath, ['scripts/validate-daily-sync-config.js'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
}

test('Google Ads daily ingestion has one scheduled owner and is fail-closed', () => {
  assert.match(
    orchestrator,
    /name: 'sync-google-ads', cmd: 'node scripts\/sync-google-ads-via-edge\.js', critical: true, retry: 1/,
  );
  assert.doesNotMatch(orchestrator, /sync-google-ads-insights\.js/);
  assert.match(edgeInvoker, /\/functions\/v1\/google-ads-backfill-dispatcher/);
  assert.doesNotMatch(edgeInvoker, /\/functions\/v1\/google-ads-daily-sync/);
  assert.match(edgeInvoker, /Google Ads account coverage mismatch/);
  assert.match(edgeDispatcher, /\/functions\/v1\/google-ads-daily-sync/);
  assert.match(edgeWorker, /provider: "google_ads"/);
});

test('GitHub Daily Sync uses the governed internal Edge ingress instead of raw service-role equality', () => {
  assert.match(edgeInvoker, /\/rest\/v1\/rpc\/nvx_get_runtime_secret/);
  assert.match(edgeInvoker, /p_name: 'REVOPS_INTERNAL_SECRET'/);
  assert.match(edgeInvoker, /'x-nvx-internal-secret': internalSecret/);
  assert.match(edgeDispatcher, /authenticateInternalRequest\(req/);
  assert.match(edgeDispatcher, /p_name: "REVOPS_INTERNAL_SECRET"/);
  assert.match(edgeDispatcher, /Authorization: `Bearer \$\{SERVICE_ROLE\}`/);
  assert.match(
    standaloneWorkflow,
    /supabase functions deploy google-ads-backfill-dispatcher --project-ref "\$SUPABASE_PROJECT_REF" --no-verify-jwt/,
  );
  assert.doesNotMatch(edgeInvoker, /secretMatches\s*\(/);
  assert.doesNotMatch(edgeInvoker, /console\.(?:log|error)[^\n]*internalSecret/);
});

test('GitHub Daily Sync no longer owns Google Ads provider credentials', () => {
  assert.doesNotMatch(validator, /'GOOGLE_ADS_DEVELOPER_TOKEN'/);
  assert.doesNotMatch(validator, /'GOOGLE_ADS_LOGIN_CUSTOMER_ID'/);
  assert.doesNotMatch(validator, /'GOOGLE_ADS_CUSTOMER_ID'/);
});

test('Daily Sync requires the canonical service-role runtime variable', () => {
  const result = runValidator(validDailySyncEnv({
    SUPABASE_SERVICE_ROLE_KEY: 'canonical-service-role',
  }));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Daily Sync required secret validation passed/);
});

test('legacy GitHub secret is mapped into the canonical runtime variable by the workflow', () => {
  assert.match(
    masterWorkflow,
    /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \|\| secrets\.NUVANX_SUPABASE_SERVICE_ROLE_KEY \}\}/,
  );
  const result = runValidator(validDailySyncEnv({
    NUVANX_SUPABASE_SERVICE_ROLE_KEY: 'legacy-only-without-workflow-mapping',
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY secret is required/);
});

test('Daily Sync fails closed when the canonical service-role runtime variable is absent', () => {
  const result = runValidator(validDailySyncEnv());
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY secret is required/);
});

test('completed August one-shot workflow is retired', () => {
  assert.equal(existsSync('.github/workflows/google-ads-backfill-once.yml'), false);
});
