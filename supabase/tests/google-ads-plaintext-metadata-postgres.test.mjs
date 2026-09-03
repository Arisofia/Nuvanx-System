import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = String(process.env.GOOGLE_ADS_INVARIANT_DATABASE_URL || '').trim();

if (!databaseUrl) {
  throw new Error('GOOGLE_ADS_INVARIANT_DATABASE_URL is required for PostgreSQL invariant acceptance');
}

const cleanupPath = fileURLToPath(new URL('../migrations/20260903060000_remove_google_ads_plaintext_developer_token.sql', import.meta.url));
const invariantPath = fileURLToPath(new URL('../migrations/20260903060100_enforce_google_ads_plaintext_metadata_invariant.sql', import.meta.url));

async function row(client, id) {
  const result = await client.query(
    'SELECT id, service, metadata, updated_at FROM public.integrations WHERE id = $1',
    [id],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

test('Google Ads plaintext metadata cleanup and write invariant execute correctly in PostgreSQL', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('DROP TABLE IF EXISTS public.integrations CASCADE');
    await client.query('DROP FUNCTION IF EXISTS public.nvx_strip_google_ads_plaintext_metadata() CASCADE');
    await client.query(`
      CREATE TABLE public.integrations (
        id text PRIMARY KEY,
        service text NOT NULL,
        metadata jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const fixedTimestamp = '2026-09-01T10:00:00.000Z';
    await client.query(
      `INSERT INTO public.integrations (id, service, metadata, updated_at) VALUES
        ('ga-legacy', 'google_ads', $1::jsonb, $4::timestamptz),
        ('ga-array', 'google_ads', $2::jsonb, $4::timestamptz),
        ('meta-legacy', 'meta', $3::jsonb, $4::timestamptz)`,
      [
        JSON.stringify({
          developer_token: 'legacy-snake',
          developerToken: 'legacy-camel',
          customerId: '9084540447',
          nested: { keep: true },
        }),
        JSON.stringify(['developer_token', 'keep-array-state']),
        JSON.stringify({ developer_token: 'meta-value', keep: 'meta-state' }),
        fixedTimestamp,
      ],
    );

    const cleanupMigration = await readFile(cleanupPath, 'utf8');
    await client.query(cleanupMigration);

    const cleaned = await row(client, 'ga-legacy');
    assert.deepEqual(cleaned.metadata, {
      customerId: '9084540447',
      nested: { keep: true },
    });
    assert.equal(new Date(cleaned.updated_at).toISOString(), fixedTimestamp);

    const arrayRow = await row(client, 'ga-array');
    assert.deepEqual(arrayRow.metadata, ['developer_token', 'keep-array-state']);
    assert.equal(new Date(arrayRow.updated_at).toISOString(), fixedTimestamp);

    const nonGoogle = await row(client, 'meta-legacy');
    assert.deepEqual(nonGoogle.metadata, { developer_token: 'meta-value', keep: 'meta-state' });
    assert.equal(new Date(nonGoogle.updated_at).toISOString(), fixedTimestamp);

    // Simulate a legacy write in the gap between cleanup and invariant installation.
    await client.query(
      `INSERT INTO public.integrations (id, service, metadata, updated_at)
       VALUES ('ga-race', 'google_ads', $1::jsonb, $2::timestamptz)`,
      [JSON.stringify({ developerToken: 'race-value', keep: 'race-state' }), fixedTimestamp],
    );

    const invariantMigration = await readFile(invariantPath, 'utf8');
    await client.query(invariantMigration);

    const raceClosed = await row(client, 'ga-race');
    assert.deepEqual(raceClosed.metadata, { keep: 'race-state' });
    assert.equal(new Date(raceClosed.updated_at).toISOString(), fixedTimestamp);

    await client.query(
      `INSERT INTO public.integrations (id, service, metadata)
       VALUES ('ga-trigger-insert', 'google_ads', $1::jsonb)`,
      [JSON.stringify({ developer_token: 'must-strip', keep: 'insert-state' })],
    );
    assert.deepEqual((await row(client, 'ga-trigger-insert')).metadata, { keep: 'insert-state' });

    await client.query(
      `UPDATE public.integrations
       SET metadata = $1::jsonb
       WHERE id = 'ga-trigger-insert'`,
      [JSON.stringify({ developerToken: 'must-strip', keep: 'update-state' })],
    );
    assert.deepEqual((await row(client, 'ga-trigger-insert')).metadata, { keep: 'update-state' });

    await client.query(
      `INSERT INTO public.integrations (id, service, metadata)
       VALUES ('ga-array-after', 'google_ads', $1::jsonb)`,
      [JSON.stringify(['developerToken', 'keep-array-state'])],
    );
    assert.deepEqual((await row(client, 'ga-array-after')).metadata, ['developerToken', 'keep-array-state']);

    await client.query('ALTER TABLE public.integrations DISABLE TRIGGER integrations_strip_google_ads_plaintext_metadata');

    for (const alias of ['developer_token', 'developerToken']) {
      await assert.rejects(
        client.query(
          `INSERT INTO public.integrations (id, service, metadata)
           VALUES ($1, 'google_ads', $2::jsonb)`,
          [`ga-check-insert-${alias}`, JSON.stringify({ [alias]: 'blocked', keep: true })],
        ),
        /integrations_google_ads_no_plaintext_developer_token/,
      );

      await assert.rejects(
        client.query(
          `UPDATE public.integrations
           SET metadata = $1::jsonb
           WHERE id = 'ga-trigger-insert'`,
          [JSON.stringify({ [alias]: 'blocked', keep: 'must-survive' })],
        ),
        /integrations_google_ads_no_plaintext_developer_token/,
      );
    }

    await client.query('ALTER TABLE public.integrations ENABLE TRIGGER integrations_strip_google_ads_plaintext_metadata');
    assert.deepEqual((await row(client, 'ga-trigger-insert')).metadata, { keep: 'update-state' });
  } finally {
    await client.query('DROP TABLE IF EXISTS public.integrations CASCADE').catch(() => {});
    await client.query('DROP FUNCTION IF EXISTS public.nvx_strip_google_ads_plaintext_metadata() CASCADE').catch(() => {});
    await client.end();
  }
});
