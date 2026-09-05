#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const shouldRun = process.env.RUN_META_ATTRIBUTION_DB_TEST === '1';

if (!shouldRun) {
  console.log('SKIP meta lead attribution PostgreSQL test (set RUN_META_ATTRIBUTION_DB_TEST=1 to run locally)');
  process.exit(0);
}

function readMigration(name) {
  return readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

function requireMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match?.[0]) throw new Error(`Could not derive ${label} from canonical migration source`);
  return match[0];
}

const canonicalSources = {
  privateSchema: readMigration('20260902124732_harden_authenticated_security_definer_rpc_surface_v2.sql'),
  clinics: readMigration('20260504125900_preview_core_tables.sql'),
  leads: readMigration('20260501090000_create_leads_table.sql'),
  metaAttribution: readMigration('20260504203000_doctoralia_lead_traceability_unified_view.sql'),
  metaLeadFields: readMigration('20260505222000_add_meta_lead_privacy_identity_fields.sql'),
  softDelete: readMigration('20260507180000_dedup_leads_by_clinic.sql'),
  leadMetadata: readMigration('20260523100000_add_leads_updated_at_trigger.sql'),
  integrations: readMigration('20260824210000_create_integrations_credentials_base.sql'),
  attributionUpdatedAt: readMigration('20260829235539_fix_meta_attribution_updated_at_trigger_contract.sql'),
  attributionIdentity: readMigration('20260830003000_add_meta_attribution_and_insights_columns.sql'),
};

// The runtime harness derives every required table/column from repository
// migrations. Supabase Preview remains the full-history replay owner; this
// focused PostgreSQL harness deliberately executes only the canonical schema
// fragments needed to exercise the invariant under test.
const schemaSql = [
  requireMatch(canonicalSources.privateSchema, /create schema if not exists private authorization postgres;/i, 'private schema'),
  requireMatch(canonicalSources.clinics, /CREATE TABLE IF NOT EXISTS public\.clinics \([\s\S]*?\n\);/i, 'clinics table'),
  requireMatch(canonicalSources.leads, /CREATE TABLE IF NOT EXISTS public\.leads \([\s\S]*?\n\);/i, 'leads table'),
  requireMatch(canonicalSources.metaAttribution, /CREATE TABLE IF NOT EXISTS public\.meta_attribution \([\s\S]*?\n\);/i, 'meta_attribution table'),
  canonicalSources.metaLeadFields,
  requireMatch(
    canonicalSources.softDelete,
    /ALTER TABLE public\.leads\s+ADD COLUMN IF NOT EXISTS merged_into_lead_id[\s\S]*?ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;/i,
    'lead soft-delete columns',
  ),
  canonicalSources.leadMetadata,
  requireMatch(canonicalSources.integrations, /CREATE TABLE IF NOT EXISTS public\.integrations \([\s\S]*?\n\);/i, 'integrations table'),
  canonicalSources.attributionUpdatedAt,
  requireMatch(
    canonicalSources.attributionIdentity,
    /ALTER TABLE public\.meta_attribution[\s\S]*?WHERE leadgen_id IS NOT NULL;/i,
    'historical attribution identity columns/index',
  ),
].join('\n\n');

const identityMigration = readMigration('20260904180400_remove_global_meta_leadgen_uniqueness.sql');
const invariantMigration = readMigration('20260904180500_enforce_meta_lead_attribution_invariant.sql');
const container = `nvx-meta-attribution-${process.pid}-${Date.now()}`;
const postgresPassword = randomBytes(24).toString('hex');
let started = false;
let cleaning = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
  }).trim();
}

function dockerAvailable() {
  try {
    docker(['version', '--format', '{{.Server.Version}}'], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

function removeContainer() {
  if (!started || cleaning) return;
  cleaning = true;
  started = false;
  try {
    docker(['rm', '-f', container], { timeout: 30_000 });
  } catch {
    // The ephemeral test container may already have exited.
  } finally {
    cleaning = false;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    removeContainer();
    process.exit(1);
  });
}

if (!dockerAvailable()) {
  console.log('SKIP meta lead attribution PostgreSQL test (Docker daemon unavailable)');
  process.exit(0);
}

async function connect(port, database = 'postgres') {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: postgresPassword,
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

async function assertSingleValue(client, sql, expected, label) {
  const { rows } = await client.query(sql);
  const value = Object.values(rows[0] ?? {})[0];
  if (String(value) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${value}`);
  }
}

async function installCanonicalPreInvariantSchema(client) {
  await client.query(schemaSql);
}

async function applyCandidateMigrations(client) {
  await client.query(identityMigration);
  await client.query('begin');
  try {
    await client.query(invariantMigration);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function validDatabaseCase(port) {
  const admin = await connect(port);
  await admin.query('create database nvx_valid');
  await admin.end();

  const client = await connect(port, 'nvx_valid');
  try {
    await installCanonicalPreInvariantSchema(client);
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

    await applyCandidateMigrations(client);

    await assertSingleValue(
      client,
      `select leadgen_id from public.meta_attribution where lead_id='11111111-1111-4111-8111-111111111111'`,
      'seed-orphan',
      'historical orphan repair',
    );

    await assertSingleValue(
      client,
      `select count(*) from pg_indexes where schemaname='public' and indexname='meta_attribution_leadgen_id_uidx'`,
      0,
      'global leadgen unique index retired',
    );

    await client.query(`
      insert into public.leads (
        id, user_id, clinic_id, source, external_id, metadata, created_at_meta
      ) values
        ('12111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', 'meta_leadgen', 'shared-provider-id', '{"page_id":"page-owner-a"}'::jsonb, '2026-09-04T09:00:00Z'),
        ('13111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-4000-8000-000000000002', 'meta_leadgen', 'shared-provider-id', '{"page_id":"page-owner-b"}'::jsonb, '2026-09-04T09:01:00Z');
    `);
    await assertSingleValue(
      client,
      `select count(*) from public.meta_attribution where leadgen_id='shared-provider-id'`,
      2,
      'same provider id may exist under distinct owners',
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
      insert into public.leads (id, source, external_id, created_at)
      values (
        '88888888-8888-4888-8888-888888888888',
        'meta_leadgen',
        'created-at-correction',
        '2026-09-04T12:00:00Z'
      );
      update public.leads
      set created_at='2026-09-03T09:00:00Z'
      where id='88888888-8888-4888-8888-888888888888';
    `);
    await assertSingleValue(
      client,
      `select captured_at = '2026-09-03T09:00:00Z'::timestamptz from public.meta_attribution where lead_id='88888888-8888-4888-8888-888888888888'`,
      true,
      'created_at-only correction convergence',
    );
    await client.query(`
      update public.leads
      set created_at='2026-09-05T09:00:00Z'
      where id='88888888-8888-4888-8888-888888888888';
    `);
    await assertSingleValue(
      client,
      `select captured_at = '2026-09-03T09:00:00Z'::timestamptz from public.meta_attribution where lead_id='88888888-8888-4888-8888-888888888888'`,
      true,
      'captured_at never moves forward on later created_at correction',
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

    for (const { sql, expected, label } of [
      {
        label: 'missing external_id',
        expected: 'meta_leadgen lead requires external_id before attribution',
        sql: `insert into public.leads (id, source) values ('44444444-4444-4444-8444-444444444444', 'meta_leadgen')`,
      },
      {
        label: 'oversized external_id',
        expected: 'meta_leadgen external_id exceeds meta_attribution.leadgen_id contract',
        sql: `insert into public.leads (id, source, external_id) values ('55555555-5555-4555-8555-555555555555', 'meta_leadgen', repeat('x',65))`,
      },
      {
        label: 'oversized page_id',
        expected: 'meta_leadgen lineage identifier exceeds meta_attribution contract',
        sql: `insert into public.leads (id, source, external_id, metadata) values ('66666666-6666-4666-8666-666666666666', 'meta_leadgen', 'valid-id', jsonb_build_object('page_id', repeat('p',65)))`,
      },
    ]) {
      let rejected = false;
      try {
        await client.query(sql);
      } catch (error) {
        const message = String(error?.message || error);
        if (!message.includes(expected)) throw error;
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
    await installCanonicalPreInvariantSchema(client);
    await client.query(`
      insert into public.leads (id, source, external_id)
      values ('77777777-7777-4777-8777-777777777777', 'meta_leadgen', repeat('z',65));
    `);

    await client.query(identityMigration);
    let rejected = false;
    await client.query('begin');
    try {
      await client.query(invariantMigration);
      await client.query('commit');
    } catch (error) {
      const message = String(error?.message || error);
      if (!message.includes('meta_leadgen external_id exceeds meta_attribution.leadgen_id contract')) throw error;
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
    '-e', `POSTGRES_PASSWORD=${postgresPassword}`,
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
  console.log('PASS Meta lead attribution migrations executed against migration-derived PostgreSQL schema');
} finally {
  removeContainer();
}
