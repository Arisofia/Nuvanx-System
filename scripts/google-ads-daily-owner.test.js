'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const test = require('node:test');

const orchestrator = readFileSync('scripts/run-daily-sync.js', 'utf8');
const edgeInvoker = readFileSync('scripts/sync-google-ads-via-edge.js', 'utf8');
const validator = readFileSync('scripts/validate-daily-sync-config.js', 'utf8');
const edgeWorker = readFileSync('supabase/functions/google-ads-daily-sync/index.ts', 'utf8');

test('Google Ads daily ingestion has one scheduled owner and is fail-closed', () => {
  assert.match(
    orchestrator,
    /name: 'sync-google-ads', cmd: 'node scripts\/sync-google-ads-via-edge\.js', critical: true, retry: 1/,
  );
  assert.doesNotMatch(orchestrator, /sync-google-ads-insights\.js/);
  assert.match(edgeInvoker, /\/functions\/v1\/google-ads-daily-sync/);
  assert.match(edgeInvoker, /Google Ads account coverage mismatch/);
  assert.match(edgeWorker, /provider: "google_ads"/);
});

test('GitHub Daily Sync no longer owns Google Ads provider credentials', () => {
  assert.doesNotMatch(validator, /'GOOGLE_ADS_DEVELOPER_TOKEN'/);
  assert.doesNotMatch(validator, /'GOOGLE_ADS_LOGIN_CUSTOMER_ID'/);
  assert.doesNotMatch(validator, /'GOOGLE_ADS_CUSTOMER_ID'/);
});

test('completed August one-shot workflow is retired', () => {
  assert.equal(existsSync('.github/workflows/google-ads-backfill-once.yml'), false);
});
