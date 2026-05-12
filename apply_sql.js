#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;
const migrationArg = process.argv[2];

function resolveSqlFile(arg) {
  if (!arg) {
    throw new Error('Usage: DATABASE_URL=<postgres-url> node apply_sql.js <path-to-sql-file>');
  }

  const resolved = path.resolve(process.cwd(), arg);
  const migrationsRoot = path.resolve(process.cwd(), 'supabase', 'migrations');
  const relative = path.relative(migrationsRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to execute SQL outside supabase/migrations. Use a tracked migration file.');
  }

  if (!resolved.endsWith('.sql')) {
    throw new Error('Only .sql migration files are supported.');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`SQL file not found: ${arg}`);
  }

  return resolved;
}

async function main() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required. Store it in GitHub Secrets or a local .env file, never in source code.');
  }

  const sqlFile = resolveSqlFile(migrationArg);
  const sql = fs.readFileSync(sqlFile, 'utf8');
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query(sql);
    console.log(`Applied SQL migration: ${path.relative(process.cwd(), sqlFile)}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
