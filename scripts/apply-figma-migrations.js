#!/usr/bin/env node
/**
 * Apply pending migrations to the Figma Supabase project (zpowfbeftxexzidlxndy).
 *
 * Usage:
 *   SUPABASE_FIGMA_DB_URL='postgresql://postgres.zpowfbeftxexzidlxndy:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
 *     node scripts/apply-figma-migrations.js
 *
 * OR add SUPABASE_FIGMA_DB_URL to backend/.env and run:
 *   npm run supabase:figma:migration:push
 *
 * Get your DB URL from:
 *   https://supabase.com/dashboard/project/zpowfbeftxexzidlxndy/settings/database
 *   → "Connection string" → "URI" (Transaction mode, port 5432)
 */

const path = require('path');
const backendModules = path.join(__dirname, '../backend/node_modules');

// Use backend's node_modules for dotenv and pg (script runs from project root)
require(path.join(backendModules, 'dotenv')).config({
  path: path.join(__dirname, '../backend/.env'),
});

const { Client } = require(path.join(backendModules, 'pg'));
const fs = require('fs');

const DB_URL = process.env.SUPABASE_FIGMA_DB_URL;

if (!DB_URL) {
  console.error('ERROR: SUPABASE_FIGMA_DB_URL is not set.');
  console.error('');
  console.error('Set it in backend/.env or export it before running this script:');
  console.error('  SUPABASE_FIGMA_DB_URL=postgresql://postgres.zpowfbeftxexzidlxndy:<password>@...');
  console.error('');
  console.error('Find your connection string at:');
  console.error('  https://supabase.com/dashboard/project/zpowfbeftxexzidlxndy/settings/database');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

// Migrations specific to the Figma project (contains 'figma' in name and is NOT for nuvanx-prod)
const FIGMA_MIGRATIONS = [
  '20260415163746_figma_dashboard_metrics.sql',
];

async function run() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('Connected to Figma Supabase project.');

    // Ensure migration tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version TEXT NOT NULL PRIMARY KEY,
        statements TEXT[],
        name TEXT
      );
    `);

    for (const filename of FIGMA_MIGRATIONS) {
      const version = filename.split('_')[0];

      // Check if already applied
      const { rows } = await client.query(
        'SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1',
        [version]
      );

      if (rows.length > 0) {
        console.log(`  [SKIP] ${filename} — already applied`);
        continue;
      }

      const sqlPath = path.join(MIGRATIONS_DIR, filename);
      if (!fs.existsSync(sqlPath)) {
        console.error(`  [ERROR] Migration file not found: ${sqlPath}`);
        process.exit(1);
      }

      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`  [RUN]  ${filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)',
          [version, filename]
        );
        await client.query('COMMIT');
        console.log(`  [OK]   ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  [FAIL] ${filename}: ${err.message}`);
        process.exit(1);
      }
    }

    console.log('\nFigma migrations complete.');
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
