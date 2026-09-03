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

function fakeSupabase(finalNames) {
  const calls = [];
  const execSupabase = (args, options = {}) => {
    calls.push({ args: [...args], capture: options.capture === true });
    if (args[0] === 'secrets' && args[1] === 'list') return inventory(finalNames);
    return '';
  };
  return { calls, execSupabase };
}

test('default deployment policy selects service account after normalization', () => {
  const identity = resolveIdentity({
    GOOGLE_ADS_CLIENT_ID: '   ',
    GOOGLE_ADS_CLIENT_SECRET: '\n\t',
    GOOGLE_ADS_REFRESH_TOKEN: ' ',
    GOOGLE_ADS_SERVICE_ACCOUNT: '  {"client_email":"svc@example.com"}  ',
  });
  assert.equal(identity.mode, 'service_account');
  assert.equal(identity.requestedMode, 'service_account');
});

test('partial OAuth does not override the explicit default service-account policy', () => {
  let calls = 0;
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN: '   ',
      GOOGLE_ADS_SERVICE_ACCOUNT: '{"client_email":"svc@example.com"}',
    },
    validateOnly: true,
    execSupabase: () => { calls += 1; },
  });
  assert.deepEqual(result, { mode: 'service_account', mutated: false });
  assert.equal(calls, 0);
});

test('explicit OAuth mode fails closed when the refresh tuple is partial', () => {
  let calls = 0;
  assert.throws(
    () => convergeGoogleAdsEdgeAuth({
      env: {
        SUPABASE_PROJECT_REF: PROJECT_REF,
        GOOGLE_ADS_AUTH_MODE: 'oauth_refresh',
        GOOGLE_ADS_CLIENT_ID: 'client-id',
        GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
        GOOGLE_ADS_REFRESH_TOKEN: '   ',
        GOOGLE_ADS_SERVICE_ACCOUNT: '{"client_email":"svc@example.com"}',
      },
      execSupabase: () => { calls += 1; },
    }),
    /complete OAuth tuple is missing/,
  );
  assert.equal(calls, 0);
});

test('default service-account mode fails closed when service account is missing', () => {
  assert.throws(
    () => convergeGoogleAdsEdgeAuth({ env: { SUPABASE_PROJECT_REF: PROJECT_REF } }),
    /service-account mode is selected but the service account is missing/,
  );
});

test('invalid explicit auth mode fails closed', () => {
  assert.throws(
    () => resolveIdentity({
      GOOGLE_ADS_AUTH_MODE: 'fallback-whatever-works',
      GOOGLE_ADS_SERVICE_ACCOUNT: 'service-account-json',
    }),
    /auth mode is invalid/,
  );
});

test('validate-only selects OAuth only when explicitly requested with a complete tuple', () => {
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      GOOGLE_ADS_AUTH_MODE: 'oauth_refresh',
      GOOGLE_ADS_CLIENT_ID: ' client-id ',
      GOOGLE_ADS_CLIENT_SECRET: ' client-secret ',
      GOOGLE_ADS_REFRESH_TOKEN: ' refresh-token ',
    },
    validateOnly: true,
  });
  assert.deepEqual(result, { mode: 'oauth_refresh', mutated: false });
});

test('OAuth convergence persists mode and complete tuple without touching service account', () => {
  const fake = fakeSupabase([
    'GOOGLE_ADS_AUTH_MODE',
    'GOOGLE_ADS_SERVICE_ACCOUNT',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
  ]);
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      GOOGLE_ADS_AUTH_MODE: 'oauth_refresh',
      GOOGLE_ADS_CLIENT_ID: ' client-id ',
      GOOGLE_ADS_CLIENT_SECRET: ' client-secret ',
      GOOGLE_ADS_REFRESH_TOKEN: ' refresh-token ',
      GOOGLE_ADS_SERVICE_ACCOUNT: ' old-service-account ',
    },
    execSupabase: fake.execSupabase,
  });

  assert.deepEqual(result, { mode: 'oauth_refresh', mutated: true });
  assert.deepEqual(fake.calls[0].args, [
    'secrets', 'set',
    'GOOGLE_ADS_AUTH_MODE=oauth_refresh',
    'GOOGLE_ADS_CLIENT_ID=client-id',
    'GOOGLE_ADS_CLIENT_SECRET=client-secret',
    'GOOGLE_ADS_REFRESH_TOKEN=refresh-token',
    '--project-ref', PROJECT_REF,
  ]);
  assert.equal(fake.calls.some((call) => call.args[1] === 'unset'), false);
});

test('service-account convergence persists selector while preserving shared OAuth keys', () => {
  const fake = fakeSupabase([
    'GOOGLE_ADS_AUTH_MODE',
    'GOOGLE_ADS_SERVICE_ACCOUNT',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
  ]);
  const result = convergeGoogleAdsEdgeAuth({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN: '',
      GOOGLE_ADS_SERVICE_ACCOUNT: ' service-account-json ',
    },
    execSupabase: fake.execSupabase,
  });

  assert.deepEqual(result, { mode: 'service_account', mutated: true });
  assert.deepEqual(fake.calls[0].args, [
    'secrets', 'set',
    'GOOGLE_ADS_AUTH_MODE=service_account',
    'GOOGLE_ADS_SERVICE_ACCOUNT=service-account-json',
    '--project-ref', PROJECT_REF,
  ]);
  assert.equal(fake.calls.some((call) => call.args[1] === 'unset'), false);
  assert.equal(fake.calls.flatMap((call) => call.args).includes('GOOGLE_ADS_DEVELOPER_TOKEN'), false);
});

test('post-mutation verification requires auth-mode selector and selected credential', () => {
  const fake = fakeSupabase(['GOOGLE_ADS_SERVICE_ACCOUNT']);
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
        GOOGLE_ADS_SERVICE_ACCOUNT: secret,
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
