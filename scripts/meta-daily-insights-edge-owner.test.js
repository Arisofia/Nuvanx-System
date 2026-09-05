'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  fetchMetaDailyInsightsViaEdge,
  normalizeSupabaseBase,
  resolveDateRange,
} = require('./fetch-meta-daily-insights-via-edge');

function withEnv(values, fn) {
  const before = {};
  for (const [name, value] of Object.entries(values)) {
    before[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

test('normalizes only a credential-free Supabase project HTTPS origin', () => {
  assert.equal(normalizeSupabaseBase('https://project.supabase.co/'), 'https://project.supabase.co');
  for (const invalid of [
    'http://project.supabase.co',
    'ftp://project.supabase.co',
    'https://user@example.com',
    'https://project.supabase.co/rest/v1',
    'https://project.supabase.co/?x=1',
    'https://project.supabase.co:8443',
    'https://supabase.co',
    'https://foo.bar.supabase.co',
    'https://project.supabase.co.attacker.test',
    'https://attacker.test',
    'not-a-url',
  ]) {
    assert.throws(() => normalizeSupabaseBase(invalid), /valid HTTPS origin/);
  }
});

test('preserves workflow date defaults and validates explicit dates', async () => {
  const now = new Date('2026-10-20T12:00:00Z');

  await withEnv({ FROM_DATE_INPUT: undefined, TO_DATE_INPUT: undefined }, () => {
    assert.deepEqual(resolveDateRange(now), {
      from: '2026-10-01',
      to: '2026-10-20',
    });
  });

  // Prior workflow semantics: an explicit historical `to` does not move the
  // implicit `from`; the latter is still the first day of the current UTC month.
  await withEnv({ FROM_DATE_INPUT: undefined, TO_DATE_INPUT: '2026-10-25' }, () => {
    assert.deepEqual(resolveDateRange(now), {
      from: '2026-10-01',
      to: '2026-10-25',
    });
  });

  await withEnv({ FROM_DATE_INPUT: '2026-08-31', TO_DATE_INPUT: '2026-09-05' }, () => {
    assert.deepEqual(resolveDateRange(now), {
      from: '2026-08-31',
      to: '2026-09-05',
    });
  });

  await withEnv({ FROM_DATE_INPUT: '2026-10-21', TO_DATE_INPUT: '2026-10-20' }, () => {
    assert.throws(() => resolveDateRange(now), /must not be after/);
  });
});

test('uses service role only for privileged RPC and internal secret for Edge', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      return new Response(JSON.stringify('internal-secret-value'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).endsWith('/functions/v1/daily-aggregates')) {
      return new Response(JSON.stringify({ success: true, rows: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await withEnv({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-value',
    NUVANX_SUPABASE_SERVICE_ROLE_KEY: undefined,
    FROM_DATE_INPUT: '2026-09-01',
    TO_DATE_INPUT: '2026-09-05',
  }, async () => {
    const result = await fetchMetaDailyInsightsViaEdge({
      fetchImpl,
      now: new Date('2026-09-05T12:00:00Z'),
    });
    assert.equal(result.summary.auth_mode, 'revops_internal_secret');
  });

  assert.equal(calls.length, 2);
  const [rpc, edge] = calls;
  assert.equal(rpc.options.redirect, 'error');
  assert.equal(rpc.options.headers.apikey, 'service-role-value');
  assert.equal(rpc.options.headers.Authorization, 'Bearer service-role-value');
  assert.deepEqual(JSON.parse(rpc.options.body), { p_name: 'REVOPS_INTERNAL_SECRET' });

  assert.equal(edge.options.redirect, 'error');
  assert.equal(edge.options.headers['x-nvx-internal-secret'], 'internal-secret-value');
  assert.equal(edge.options.headers.Authorization, undefined);
  assert.equal(edge.options.headers.apikey, undefined);
  assert.ok(!JSON.stringify(edge.options.headers).includes('service-role-value'));
  assert.deepEqual(JSON.parse(edge.options.body), {
    action: 'fetch_meta_insights',
    from: '2026-09-01',
    to: '2026-09-05',
  });
});

test('rejects an HTTPS non-Supabase origin before any credential-bearing request', async () => {
  let calls = 0;
  await withEnv({
    SUPABASE_URL: 'https://attacker.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-value',
    FROM_DATE_INPUT: '2026-09-01',
    TO_DATE_INPUT: '2026-09-05',
  }, async () => {
    await assert.rejects(
      fetchMetaDailyInsightsViaEdge({ fetchImpl: async () => { calls += 1; throw new Error('must not run'); } }),
      /valid HTTPS origin/,
    );
  });
  assert.equal(calls, 0);
});

test('fails closed when Edge does not confirm success', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify('internal-secret-value'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: false, kind: 'provider_error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await withEnv({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-value',
    FROM_DATE_INPUT: '2026-09-01',
    TO_DATE_INPUT: '2026-09-05',
  }, async () => {
    await assert.rejects(
      fetchMetaDailyInsightsViaEdge({ fetchImpl }),
      /Edge reconciliation failed \(HTTP 502, kind=provider_error\)/,
    );
  });
});
