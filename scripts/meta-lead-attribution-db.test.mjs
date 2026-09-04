#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const shouldRun = process.env.CI === 'true' || process.env.RUN_META_ATTRIBUTION_DB_TEST === '1';

if (!shouldRun) {
  console.log('SKIP meta lead attribution PostgreSQL test (set RUN_META_ATTRIBUTION_DB_TEST=1 to run locally)');
  process.exit(0);
}

const migration = readFileSync(
  new URL('../supabase/migrations/20260904180500_enforce_meta_lead_attribution_invariant.sql', import.meta.url),
  'utf8',
);
const container = `nvx-meta-attribution-${process.pid}-${Date.now()}`;
let started = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] }).trim();
}

async function connect(port, database = 'postgres') {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: 'postgres',
      database,
      connectionTimeoutMillis: 1000,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error('PostgreSQL test container did not become ready');
}

const fixtureSql = `
create schema if not exists private;

create table public.leads (
  id uuid primary key,
  source varchar(255),
  external_id varchar(255),
  metadata jsonb,
  form_id varchar(255),
  meta_form_id text,
  campaign_id varchar(255),
  campaign_name varchar(512),
  adset_id varchar(255),
  adset_name varchar(512),
  ad_id varchar(255),
  meta_ad_id text,
  ad_name varchar(512),
  meta_ad_name text,
  created_at_meta timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz
);

create table public.meta_attribution (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  leadgen_id varchar(64) not null,
  page_id varchar(64),
  form_id varchar(64),
  campaign_id varchar(64),
  campaign_name varchar(255),
  adset_id varchar(64),
  adset_name varchar(255),
  ad_id varchar(64),
  ad_name varchar(255),
  captured_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
`;

async function assertSingleValue(client, sql, expected, label) {
  const { rows } = await client.query(sql);
  const value = Object.values(rows[0] ?? {})[0];
  if (String(value) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${value}`);
  }
}

async function validDatabaseCase(port) {
  const admin = await connect(port);
  await admin.query('create database nvx_valid');
  await admin.end();

  const client = await connect(port, 'nvx_valid');
  try {
    await client.query(fixtureSql);
    await client.query(`
      insert into public.leads (
        id, source, external_id, metadata, form_id, campaign_id, campaign_name,
        adset_id, adset_name, ad_id, ad_name, created_at_meta
      ) values (
        '11111111-1111-4111-8111-111111111111', 'meta_leadgen', 'seed-orphan',
        '{"page_id":"seed-page"}'::jsonb, 'seed-form', 'seed-campaign', 'Seed Campaign',
        'seed-adset', 'Seed Adset', 'seed-ad', 'Seed Ad', '2026-09-01T10:00:00Z'
      );
    `);

    await client.query(migration);

    await assertSingleValue(
      client,
      `select leadgen_id from public.meta_attribution where lead_id='11111111-1111-4111-8111-111111111111'`,
      'seed-orphan',
      'historical orphan repair',
    );

    await client.query(`
      insert into public.leads (
        id, source, external_id, metadata, meta_form_id, campaign_id, adset_id, meta_ad_id, created_at_meta
      ) values (
        '22222222-2222-4222-8222-222222222222', 'meta_leadgen', 'new-provider-lead',
        '{"page_id":"page-v1"}'::jsonb, 'form-v1', 'campaign-v1', 'adset-v1', 'ad-v1',
        '2026-09-04T10:00:00Z'
      );
    `);
    await assertSingleValue(
      client,
      `select page_id from public.meta_attribution where lead_id='22222222-2222-4222-8222-222222222222'`,
      'page-v1',
      'insert trigger',
    );

    await client.query(`
      update public.leads
      set metadata='{"page_id":"page-v2"}'::jsonb
      where id='22222222-2222-4222-8222-222222222222';
    `);
    await assertSingleValue(
      client,
      `select page_id from public.meta_attribution where lead_id='22222222-2222-4222-8222-222222222222'`,
      'page-v2',
      'metadata-only update convergence',
    );

    await client.query(`
      insert into public.leads (id, source, external_id)
      values ('33333333-3333-4333-8333-333333333333', 'manual', 'existing-provider-lead');
      insert into public.meta_attribution (lead_id, leadgen_id, page_id, form_id)
      values ('33333333-3333-4333-8333-333333333333', 'existing-provider-lead', 'preserved-page', 'preserved-form');
      update public.leads
      set source='meta_leadgen'
      where id='33333333-3333-4333-8333-333333333333';
    `);
    await assertSingleValue(
      client,
      `select page_id from public.meta_attribution where lead_id='33333333-3333-4333-8333-333333333333'`,
      'preserved-page',
      'optional attribution preservation',
    );

    for (const { sql, label } of [
      {
        label: 'missing external_id',
        sql: `insert into public.leads (id, source) values ('44444444-4444-4444-8444-444444444444', 'meta_leadgen')`,
      },
      {
        label: 'oversized external_id',
        sql: `insert into public.leads (id, source, external_id) values ('55555555-5555-4555-8555-555555555555', 'meta_leadgen', repeat('x',65))`,
      },
      {
        label: 'oversized page_id',
        sql: `insert into public.leads (id, source, external_id, metadata) values ('66666666-6666-4666-8666-666666666666', 'meta_leadgen', 'valid-id', jsonb_build_object('page_id', repeat('p',65)))`,
      },
    ]) {
      let rejected = false;
      try {
        await client.query(sql);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`${label}: invalid Meta lead write was accepted`);
    }

    await assertSingleValue(
      client,
      `select count(*) from public.leads l left join public.meta_attribution a on a.lead_id=l.id where lower(btrim(coalesce(l.source,'')))='meta_leadgen' and l.deleted_at is null and a.lead_id is null`,
      0,
      'zero live Meta attribution orphans',
    );
  } finally {
    await client.end();
  }
}

async function invalidHistoricalCase(port) {
  const admin = await connect(port);
  await admin.query('create database nvx_invalid');
  await admin.end();

  const client = await connect(port, 'nvx_invalid');
  try {
    await client.query(fixtureSql);
    await client.query(`
      insert into public.leads (id, source, external_id)
      values ('77777777-7777-4777-8777-777777777777', 'meta_leadgen', repeat('z',65));
    `);

    let rejected = false;
    try {
      await client.query(migration);
    } catch {
      rejected = true;
      await client.query('rollback').catch(() => {});
    }
    if (!rejected) throw new Error('migration accepted an invalid historical Meta attribution orphan');

    await assertSingleValue(
      client,
      `select count(*) from public.meta_attribution where lead_id='77777777-7777-4777-8777-777777777777'`,
      0,
      'invalid historical orphan rollback',
    );
    await assertSingleValue(
      client,
      `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='nvx_converge_meta_lead_attribution'`,
      0,
      'migration object rollback',
    );
  } finally {
    await client.end();
  }
}

try {
  docker([
    'run', '-d', '--rm', '--name', container,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-p', '127.0.0.1::5432',
    'postgres:17-alpine',
  ]);
  started = true;
  const mapping = docker(['port', container, '5432/tcp']);
  const portMatch = mapping.match(/:(\d+)\s*$/m);
  if (!portMatch) throw new Error(`Could not resolve PostgreSQL test port from: ${mapping}`);
  const port = Number(portMatch[1]);

  const readiness = await connect(port);
  await readiness.end();

  await validDatabaseCase(port);
  await invalidHistoricalCase(port);
  console.log('PASS Meta lead attribution migration executed against PostgreSQL with runtime invariant coverage');
} finally {
  if (started) {
    try {
      docker(['rm', '-f', container]);
    } catch {
      // The container may already have exited; cleanup is best-effort only.
    }
  }
}
