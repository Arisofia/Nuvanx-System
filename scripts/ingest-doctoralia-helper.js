#!/usr/bin/env node
/**
 * ingest-doctoralia-helper.js
 * ──────────────────────────────
 * Interactive helper to guide through Doctoralia ingestion setup and execution.
 * Usage: node scripts/ingest-doctoralia-helper.js
 */

'use strict';

const readline = require('readline');
const path = require('path');
const fs = require('fs');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => {
    rl.question(`${colors.cyan}?${colors.reset} ${question}\n> `, resolve);
  });
}

function log(type, message) {
  const icons = {
    info: `${colors.cyan}ℹ${colors.reset}`,
    success: `${colors.green}✓${colors.reset}`,
    error: `${colors.red}✗${colors.reset}`,
    warning: `${colors.yellow}⚠${colors.reset}`,
  };
  console.log(`${icons[type]} ${message}`);
}

async function main() {
  console.log(`\n${colors.bright}${colors.cyan}╔═══════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║   Doctoralia Data Ingestion Setup & Execution Helper   ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚═══════════════════════════════════════════════════════╝${colors.reset}\n`);

  log('info', 'This helper will guide you through setting up Doctoralia ingestion.');
  log('info', 'You will need: Google Sheets link, service account credentials, and database access.\n');

  const step = await ask(`What would you like to do?
  1. Validate current setup
  2. Run ingestion (dry-run)
  3. Run ingestion (commit changes)
  4. View setup documentation
  5. Exit`);

  switch (step.trim()) {
    case '1':
      console.log('\n' + colors.cyan + 'Running setup validation...' + colors.reset + '\n');
      require('./validate-doctoralia-setup.js');
      break;

    case '2':
      console.log('\n' + colors.cyan + 'Running ingestion in DRY-RUN mode (preview only)...' + colors.reset + '\n');
      process.env.DRY_RUN = '1';
      require('../scripts/ingest-doctoralia.js');
      break;

    case '3':
      const confirm = await ask('Are you sure you want to commit data to the database? (yes/no)');
      if (confirm.toLowerCase() === 'yes' || confirm.toLowerCase() === 'y') {
        console.log('\n' + colors.cyan + 'Running ingestion with database commits...' + colors.reset + '\n');
        delete process.env.DRY_RUN;
        require('../scripts/ingest-doctoralia.js');
      } else {
        log('warning', 'Ingestion cancelled.');
      }
      break;

    case '4':
      console.log('\n' + colors.cyan + 'Setup Documentation' + colors.reset + '\n');
      const docPath = path.join(__dirname, 'setup-doctoralia-ingest.md');
      if (fs.existsSync(docPath)) {
        const docs = fs.readFileSync(docPath, 'utf8');
        console.log(docs);
      } else {
        log('error', 'Documentation not found: ' + docPath);
      }
      break;

    case '5':
      log('info', 'Exiting.');
      rl.close();
      process.exit(0);
      break;

    default:
      log('error', 'Invalid choice. Please select 1-5.');
      setTimeout(() => main(), 500);
  }
}

main().catch(err => {
  log('error', err.message);
  rl.close();
  process.exit(1);
});
