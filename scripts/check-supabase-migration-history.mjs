import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const migrationsDir = path.resolve('supabase/migrations');
const databaseUrl = String(process.env.SESSION_URL || process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  console.error('SESSION_URL or DATABASE_URL is required for Supabase migration history parity validation.');
  process.exit(1);
}

const filenames = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

const localByVersion = new Map();
for (const filename of filenames) {
  const version = filename.split('_', 1)[0];
  if (!/^\d{12,14}$/.test(version)) {
    console.error(`Invalid Supabase migration version prefix: ${filename}`);
    process.exit(1);
  }
  if (localByVersion.has(version)) {
    console.error(`Duplicate local Supabase migration version ${version}: ${localByVersion.get(version)}, ${filename}`);
    process.exit(1);
  }
  localByVersion.set(version, filename);
}

const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const { rows } = await client.query(
    'select version::text as version from supabase_migrations.schema_migrations order by version'
  );

  const remoteVersions = rows.map((row) => String(row.version));
  const remoteMissingLocal = remoteVersions.filter((version) => !localByVersion.has(version));
  const remoteSet = new Set(remoteVersions);
  const localPendingRemote = [...localByVersion.keys()].filter((version) => !remoteSet.has(version));

  console.log(`Local migration versions: ${localByVersion.size}`);
  console.log(`Remote applied migration versions: ${remoteVersions.length}`);

  if (localPendingRemote.length > 0) {
    console.log(`Local versions not yet recorded remotely (allowed pending migrations): ${localPendingRemote.join(', ')}`);
  }

  if (remoteMissingLocal.length > 0) {
    console.error('Remote migration versions missing from supabase/migrations/:');
    for (const version of remoteMissingLocal) console.error(`- ${version}`);
    process.exitCode = 1;
  } else {
    console.log('OK: every remote migration version has an append-only Git representation.');
  }
} finally {
  await client.end().catch(() => undefined);
}
