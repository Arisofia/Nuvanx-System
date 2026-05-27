#!/usr/bin/env node
/**
 * check-capi-pending-pagadas.js
 *
 * Helper script to detect "Pagada" productions that have NOT yet been sent to Meta CAPI.
 * Run this periodically (manually or via cron) to catch any anomalies.
 *
 * Usage:
 *   node scripts/check-capi-pending-pagadas.js
 *
 * Requires: DATABASE_URL in environment (or .env)
 */

const { Client } = require('pg');

const query = `
  SELECT 
    id,
    created_at,
    estado,
    importe,
    phone_normalized,
    clinic_id,
    capi_sent
  FROM public.produccion_intermediarios
  WHERE estado ILIKE '%pagada%'
    AND (capi_sent IS FALSE OR capi_sent IS NULL)
  ORDER BY created_at DESC;
`;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query(query);

    if (res.rows.length === 0) {
      console.log('✅ No pending "Pagada" records without capi_sent. All good.');
    } else {
      console.log(`⚠️  Found ${res.rows.length} "Pagada" records that have NOT been sent to Meta CAPI:\n`);
      console.table(res.rows);
      console.log('\nRecommendation: Investigate why these were not processed by the webhook.');
    }
  } catch (err) {
    console.error('Error running anomaly query:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();