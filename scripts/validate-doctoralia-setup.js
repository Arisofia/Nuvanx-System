#!/usr/bin/env node
/**
 * validate-doctoralia-setup.js
 * ────────────────────────────────
 * Checks if the Doctoralia ingestion pipeline is ready to run.
 * Validates: env vars, service account file, Supabase connectivity, clinic_id.
 * Usage: node scripts/validate-doctoralia-setup.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const backendDir = path.join(__dirname, '..', 'backend');
require(path.join(backendDir, 'node_modules', 'dotenv')).config({ path: path.join(backendDir, '.env') });

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(status, message) {
  const icon = status === '✓' ? colors.green : status === '✗' ? colors.red : colors.yellow;
  console.log(`${icon}${status}${colors.reset} ${message}`);
}

async function validate() {
  console.log(`\n${colors.cyan}=== Doctoralia Ingestion Setup Validator ===${colors.reset}\n`);

  let passed = 0, failed = 0;

  // 1. Check env vars
  console.log(`${colors.cyan}[1/4] Environment Variables${colors.reset}`);
  
  const docSheet = process.env.DOCTORALIA_SHEET_ID;
  if (docSheet) {
    log('✓', `DOCTORALIA_SHEET_ID: ${docSheet}`);
    passed++;
  } else {
    log('✗', 'DOCTORALIA_SHEET_ID not set');
    failed++;
  }

  const clinicId = process.env.CLINIC_ID;
  if (clinicId) {
    log('✓', `CLINIC_ID: ${clinicId}`);
    passed++;
  } else {
    log('✗', 'CLINIC_ID not set (default: 4207023b-eac1-4249-bf0f-d9b1e36a5d7a)');
    failed++;
  }

  // 2. Check service account file
  console.log(`\n${colors.cyan}[2/4] Google Service Account${colors.reset}`);
  
  const saPath = process.env.GOOGLE_SERVICE_ACCOUNT_FILE
    || path.join(__dirname, '..', 'backend', 'google-service-account.json');
  
  if (fs.existsSync(saPath)) {
    try {
      const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      if (sa.type === 'service_account') {
        log('✓', `Service account found: ${sa.client_email}`);
        passed++;
      } else {
        log('✗', 'Service account JSON invalid (missing type)');
        failed++;
      }
    } catch (err) {
      log('✗', `Service account JSON parse error: ${err.message}`);
      failed++;
    }
  } else {
    log('✗', `Service account not found: ${saPath}`);
    log('?', 'Download from: https://console.cloud.google.com/ → Service Accounts → Keys');
    failed++;
  }

  // 3. Check Supabase connectivity
  console.log(`\n${colors.cyan}[3/4] Supabase Connectivity${colors.reset}`);
  
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    log('✓', 'DATABASE_URL configured');
    passed++;
    
    try {
      const { createClient } = require(path.join(backendDir, 'node_modules', '@supabase', 'supabase-js'));
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      log('✓', 'Supabase client initialized');
      passed++;
    } catch (err) {
      log('✗', `Supabase client error: ${err.message}`);
      failed++;
    }
  } else {
    log('✗', 'DATABASE_URL not set');
    failed++;
  }

  // 4. Check database tables
  console.log(`\n${colors.cyan}[4/4] Database Schema${colors.reset}`);
  
  try {
    const { Pool } = require(path.join(backendDir, 'node_modules', 'pg'));
    const pool = new Pool({ connectionString: dbUrl, max: 1 });
    
    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('patients', 'financial_settlements', 'clinics')
    `);
    
    const tables = tablesRes.rows.map(r => r.table_name);
    
    if (tables.includes('patients')) {
      log('✓', 'patients table exists');
      passed++;
    } else {
      log('✗', 'patients table not found');
      failed++;
    }
    
    if (tables.includes('financial_settlements')) {
      log('✓', 'financial_settlements table exists');
      passed++;
    } else {
      log('✗', 'financial_settlements table not found');
      failed++;
    }
    
    if (tables.includes('clinics')) {
      log('✓', 'clinics table exists');
      passed++;
    } else {
      log('✗', 'clinics table not found');
      failed++;
    }

    // Check if default clinic exists
    if (clinicId) {
      const clinicRes = await pool.query('SELECT id FROM clinics WHERE id = $1', [clinicId]);
      if (clinicRes.rows.length > 0) {
        log('✓', `Clinic ${clinicId} exists`);
        passed++;
      } else {
        log('?', `Clinic ${clinicId} not found (will be created during ingest)`);
      }
    }

    await pool.end();
  } catch (err) {
    log('✗', `Database query error: ${err.message}`);
    failed++;
  }

  // Summary
  console.log(`\n${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}\n`);

  if (failed === 0) {
    console.log(`${colors.green}✓ All checks passed! Ready to run:${colors.reset}`);
    console.log(`  node scripts/ingest-doctoralia.js\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}✗ Fix the above issues before running ingest.${colors.reset}\n`);
    console.log(`${colors.yellow}Setup guide: See scripts/setup-doctoralia-ingest.md${colors.reset}\n`);
    process.exit(1);
  }
}

validate().catch(err => {
  console.error(`${colors.red}Validation error: ${err.message}${colors.reset}\n`);
  process.exit(1);
});
