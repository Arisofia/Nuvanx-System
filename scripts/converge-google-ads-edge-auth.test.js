'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  convergeGoogleAdsEdgeAuth,
  resolveIdentity,
} = require('./converge-google-ads-edge-auth');

const PROJECT_REF = 'abcdefghijklmnopqrst';

function inventory(names) {
  return JSON.stringify(names.map((name) => ({ name, digest: 'not-a-secret-value' })));
}

function fakeSupabase(initialNames, finalNames) {
  const calls = [];
  let listCount = 0;
  const execSupabase = (args, options = {}) => {
    calls.push({ args: [...args], capture: options.capture === true });
    if (args[0] === 'secrets' && args[1] === 'list') {
      listCount += 1;
      return listCount === 1 ? inventory(initialNames) : inventory(finalNames);
    }
    return '';
  };
  return { calls, execSupabase };
}

test('whitespace-only OAuth values are absent after normalization', () => {
  const identity = resolveIdentity({
    GOOGLE_ADS_CLIENT_ID: '   ',
    GOOGLE_ADS_CLIENT_SECRET: '\n\t',
    GOOGLE_ADS_REFRESH_TOKEN: ' ',
    GOOGLE_ADS_SERVICE_ACCOUNT: '  {"client_email":"svc@example.com"}  ',
  });
  assert.equal(identity.mode, 'service_account');
});

test('partial OAuth fails closed before any Supabase call', () => {
  let calls = 0;
  assert.throws(
    () => convergeGoogleAdsEdgeAuth({
      env: {
        SUPABASE_PROJECT_REF: PROJECT_REF,
        GOOGLE_ADS_CLIENT_ID: 'client-id',
        GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
        GOOGLE_ADS_REFRESH_TOKEN: '   ',
        GOOGLE_ADS_SERVICE_ACCOUNT: '{"client_email":"svc@example.com"}',
      },
      execSupabase: () => { calls += 1; },
    }),
    /OAuth refresh identity is partial/,
  );
  assert.equal(calls, 0);
});

test('missing OAuth and service account fails closed before any Supabase call', () => {
  let calls = 0;
  assert.throws(
    () => convergeGoogleAdsEdgeAuth({
      env: { SUPABASE_PROJECT_REF: PROJECT_REF },
      execSupabase: () => { calls += 1; },
    }),
    /No complete Google Ads runtime identity/,
  );
  assert.equal(calls, 0);
});

test('validate-only selects a complete OAuth tuple without touching Supabase', () => {
  let calls = 0;
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      GOOGLE_ADS_CLIENT_ID: ' client-id ',
      GOOGLE_ADS_CLIENT_SECRET: ' client-secret ',
      GOOGLE_ADS_REFRESH_TOKEN: ' refresh-token ',
    },
    validateOnly: true,
    execSupabase: () => { calls += 1; },
  });
  assert.deepEqual(result, { mode: 'oauth_refresh', mutated: false });
  assert.equal(calls, 0);
});

test('OAuth convergence sets the full tuple and preserves the service account required by the legacy core API', () => {
  const fake = fakeSupabase(
    ['GOOGLE_ADS_SERVICE_ACCOUNT'],
    ['GOOGLE_ADS_SERVICE_ACCOUNT', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
  );
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      GOOGLE_ADS_CLIENT_ID: ' client-id ',
      GOOGLE_ADS_CLIENT_SECRET: ' client-secret ',
      GOOGLE_ADS_REFRESH_TOKEN: ' refresh-token ',
      GOOGLE_ADS_SERVICE_ACCOUNT: ' old-service-account ',
    },
    execSupabase: fake.execSupabase,
  });

  assert.deepEqual(result, { mode: 'oauth_refresh', mutated: true });
  assert.deepEqual(fake.calls[0].args, ['secrets', 'list', '--project-ref', PROJECT_REF, '--output', 'json']);
  assert.deepEqual(fake.calls[1].args, [
    'secrets', 'set',
    'GOOGLE_ADS_CLIENT_ID=client-id',
    'GOOGLE_ADS_CLIENT_SECRET=client-secret',
    'GOOGLE_ADS_REFRESH_TOKEN=refresh-token',
    '--project-ref', PROJECT_REF,
  ]);
  assert.deepEqual(fake.calls[2].args, ['secrets', 'list', '--project-ref', PROJECT_REF, '--output', 'json']);
  assert.equal(fake.calls.some((call) => call.args[1] === 'unset'), false);
  assert.equal(fake.calls.flatMap((call) => call.args).includes('GOOGLE_ADS_DEVELOPER_TOKEN'), false);
});

test('service-account convergence sets service account, removes only stale OAuth keys, and verifies exact secret shape', () => {
  const fake = fakeSupabase(
    ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
    ['GOOGLE_ADS_SERVICE_ACCOUNT'],
  );
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      GOOGLE_ADS_SERVICE_ACCOUNT: ' service-account-json ',
    },
    execSupabase: fake.execSupabase,
  });

  assert.deepEqual(result, { mode: 'service_account', mutated: true });
  assert.deepEqual(fake.calls[1].args, [
    'secrets', 'set',
    'GOOGLE_ADS_SERVICE_ACCOUNT=service-account-json',
    '--project-ref', PROJECT_REF,
  ]);
  assert.deepEqual(fake.calls[2].args, [
    'secrets', 'unset',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    '--project-ref', PROJECT_REF,
  ]);
  assert.equal(fake.calls.flatMap((call) => call.args).includes('GOOGLE_ADS_DEVELOPER_TOKEN'), false);
});

test('OAuth convergence is idempotent and leaves a compatibility service account untouched', () => {
  const fake = fakeSupabase(
    ['GOOGLE_ADS_SERVICE_ACCOUNT', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
    ['GOOGLE_ADS_SERVICE_ACCOUNT', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
  );
  convergeGoogleAdsEdgeAuth({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
      GOOGLE_ADS_SERVICE_ACCOUNT: 'service-account-json',
    },
    execSupabase: fake.execSupabase,
  });
  assert.equal(fake.calls.some((call) => call.args[1] === 'unset'), false);
});

test('post-mutation verification fails closed if OAuth keys remain in service-account mode', () => {
  const fake = fakeSupabase(
    ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
    ['GOOGLE_ADS_SERVICE_ACCOUNT', 'GOOGLE_ADS_REFRESH_TOKEN'],
  );
  assert.throws(
    () => convergeGoogleAdsEdgeAuth({
      env: {
        SUPABASE_PROJECT_REF: PROJECT_REF,
        GOOGLE_ADS_SERVICE_ACCOUNT: 'service-account-json',
      },
      execSupabase: fake.execSupabase,
    }),
    /verification failed/,
  );
});

test('CLI failures are normalized without echoing credential material', () => {
  const secret = 'credential-material-must-not-leak';
  const execSupabase = (args) => {
    if (args[1] === 'list') return inventory([]);
    throw new Error(`provider detail ${secret}`);
  };
  assert.throws(
    () => convergeGoogleAdsEdgeAuth({
      env: {
        SUPABASE_PROJECT_REF: PROJECT_REF,
        GOOGLE_ADS_CLIENT_ID: 'client-id',
        GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
        GOOGLE_ADS_REFRESH_TOKEN: secret,
      },
      execSupabase,
    }),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      assert.match(error.message, /convergence failed/);
      return true;
    },
  );
});
