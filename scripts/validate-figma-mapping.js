#!/usr/bin/env node

/**
 * Figma ↔ GitHub Validation Script
 *
 * Validates that the component mapping file is well-formed and that all
 * referenced code files exist in the repository.
 *
 * Usage:
 *   node scripts/validate-figma-mapping.js              # Run locally
 *   node scripts/validate-figma-mapping.js --ci         # Run in CI (exit 0 even on warnings)
 *   FIGMA_ACCESS_TOKEN=<token> node scripts/validate-figma-mapping.js --api-check
 *
 * Exit codes:
 *   0 - Validation passed (or warnings in non-strict mode)
 *   1 - Validation failed (strict mode)
 *   2 - Critical error (file not found, invalid JSON)
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const args = process.argv.slice(2);
const isCI = args.includes('--ci');
const apiCheck = args.includes('--api-check');

// Paths
const repoRoot = path.resolve(__dirname, '..');
const mappingFilePath = path.join(repoRoot, 'docs', 'figma-component-map.json');
const exampleFilePath = path.join(repoRoot, 'docs', 'figma-component-map.example.json');
const appFilePath = path.join(repoRoot, 'frontend', 'src', 'App.jsx');

// Validation state
let errors = 0;
let warnings = 0;
let passed = 0;

function log(message, type = 'info') {
  const prefix = {
    error: `${colors.red}[ERROR]${colors.reset}`,
    warn: `${colors.yellow}[WARN]${colors.reset}`,
    pass: `${colors.green}[PASS]${colors.reset}`,
    info: `${colors.cyan}[INFO]${colors.reset}`,
  }[type] || '';
  console.log(`${prefix} ${message}`);
}

function header(message) {
  console.log(`\n${colors.bold}${colors.cyan}${message}${colors.reset}`);
  console.log('━'.repeat(50));
}

function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    passed++;
    return true;
  } else {
    errors++;
    log(`${description} not found: ${filePath}`, 'error');
    return false;
  }
}

function validateJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    passed++;
    log('JSON schema valid', 'pass');
    return data;
  } catch (err) {
    errors++;
    log(`Invalid JSON: ${err.message}`, 'error');
    return null;
  }
}

function validateRequiredFields(obj, requiredFields, objName) {
  const missing = requiredFields.filter(field => {
    const value = field.split('.').reduce((o, key) => o?.[key], obj);
    return value === undefined || value === null || value === '';
  });

  if (missing.length > 0) {
    errors++;
    log(`${objName} missing required fields: ${missing.join(', ')}`, 'error');
    return false;
  }
  passed++;
  return true;
}

function validateFileExistence(items, type) {
  const missingFiles = [];

  items.forEach(item => {
    const filePath = path.join(repoRoot, item.component);
    if (!fs.existsSync(filePath)) {
      missingFiles.push({ name: item.name, path: item.component });
    }
  });

  if (missingFiles.length > 0) {
    errors++;
    log(`${missingFiles.length} ${type} file(s) missing:`, 'error');
    missingFiles.forEach(f => log(`  - ${f.name}: ${f.path}`, 'error'));
    return false;
  } else {
    passed++;
    log(`All ${type} files exist (${items.length}/${items.length})`, 'pass');
    return true;
  }
}

function validateRoutes(screens) {
  if (!fs.existsSync(appFilePath)) {
    warnings++;
    log('App.jsx not found, skipping route validation', 'warn');
    return;
  }

  const appContent = fs.readFileSync(appFilePath, 'utf8');
  const missingRoutes = [];

  screens.forEach(screen => {
    // Check if route is defined in App.jsx
    // Look for pattern: path="route" or <Route path="route"
    const routePattern = new RegExp(`path=["']${screen.route.replace(/^\//, '')}["']`);
    if (!routePattern.test(appContent)) {
      missingRoutes.push(screen.route);
    }
  });

  if (missingRoutes.length > 0) {
    warnings++;
    log(`${missingRoutes.length} route(s) not found in App.jsx: ${missingRoutes.join(', ')}`, 'warn');
  } else {
    passed++;
    log(`All routes match App.jsx (${screens.length}/${screens.length})`, 'pass');
  }
}

function checkDuplicateNames(items, type) {
  const names = items.map(item => item.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

  if (duplicates.length > 0) {
    errors++;
    log(`Duplicate ${type} names found: ${[...new Set(duplicates)].join(', ')}`, 'error');
    return false;
  } else {
    passed++;
    log(`No duplicate ${type} names`, 'pass');
    return true;
  }
}

function checkStaleness(mapping) {
  const lastSync = new Date(mapping.figma.lastSync);
  const now = new Date();
  const daysSinceSync = Math.floor((now - lastSync) / (1000 * 60 * 60 * 24));
  const threshold = mapping.validationRules?.staleDays || 30;

  if (daysSinceSync > threshold) {
    warnings++;
    log(`Mapping last synced ${daysSinceSync} days ago (threshold: ${threshold} days)`, 'warn');
  } else {
    passed++;
    log(`Mapping is up to date (${daysSinceSync} days old)`, 'pass');
  }
}

function validateFigmaNodeIds(items, type) {
  const invalidNodeIds = items.filter(item => {
    // Figma node IDs should match pattern: digits:digits (e.g., "123:456")
    const nodeIdPattern = /^\d+:\d+$/;
    return item.figmaNodeId && !nodeIdPattern.test(item.figmaNodeId);
  });

  if (invalidNodeIds.length > 0) {
    errors++;
    log(`${invalidNodeIds.length} ${type} have invalid figmaNodeId format:`, 'error');
    invalidNodeIds.forEach(item => log(`  - ${item.name}: ${item.figmaNodeId}`, 'error'));
    return false;
  }

  const missingNodeIds = items.filter(item =>
    !item.figmaNodeId || item.figmaNodeId === 'REPLACE_WITH_NODE_ID'
  );

  if (missingNodeIds.length > 0) {
    warnings++;
    log(`${missingNodeIds.length} ${type} missing figmaNodeId (placeholder values):`, 'warn');
    missingNodeIds.forEach(item => log(`  - ${item.name}`, 'warn'));
  }

  passed++;
  return true;
}

async function main() {
  header('🎨 Figma Validation Report');

  // Check if mapping file exists, if not suggest copying from example
  if (!fs.existsSync(mappingFilePath)) {
    if (fs.existsSync(exampleFilePath)) {
      log('Mapping file not found. Copy from example:', 'warn');
      log(`  cp ${exampleFilePath} ${mappingFilePath}`, 'info');
      log('  Then populate with real Figma file key and node IDs', 'info');
    } else {
      log('Neither mapping file nor example file found', 'error');
      errors++;
    }
    process.exit(2);
  }

  // Validate JSON structure
  log('Validating JSON structure...', 'info');
  const mapping = validateJSON(mappingFilePath);
  if (!mapping) {
    process.exit(2);
  }

  // Validate required top-level fields
  log('Checking required fields...', 'info');
  validateRequiredFields(mapping, [
    'version',
    'repository',
    'figma.fileKey',
    'figma.fileUrl',
    'figma.lastSync',
    'screens',
    'components'
  ], 'Mapping file');

  // Validate screens
  if (mapping.screens && mapping.screens.length > 0) {
    header(`📱 Validating Screens (${mapping.screens.length})`);

    mapping.screens.forEach((screen, index) => {
      validateRequiredFields(screen, [
        'name',
        'route',
        'figmaNodeId',
        'figmaUrl',
        'component',
        'status'
      ], `Screen #${index + 1} (${screen.name || 'unnamed'})`);
    });

    validateFileExistence(mapping.screens, 'screen');
    validateRoutes(mapping.screens);
    checkDuplicateNames(mapping.screens, 'screen');
    validateFigmaNodeIds(mapping.screens, 'screens');
  } else {
    warnings++;
    log('No screens defined in mapping', 'warn');
  }

  // Validate components
  if (mapping.components && mapping.components.length > 0) {
    header(`🧩 Validating Components (${mapping.components.length})`);

    mapping.components.forEach((component, index) => {
      validateRequiredFields(component, [
        'name',
        'figmaNodeId',
        'figmaUrl',
        'component',
        'status'
      ], `Component #${index + 1} (${component.name || 'unnamed'})`);
    });

    validateFileExistence(mapping.components, 'component');
    checkDuplicateNames(mapping.components, 'component');
    validateFigmaNodeIds(mapping.components, 'components');
  } else {
    warnings++;
    log('No components defined in mapping', 'warn');
  }

  // Check staleness
  header('📅 Checking Freshness');
  checkStaleness(mapping);

  // Figma API validation (if enabled)
  if (apiCheck) {
    header('🔌 Figma API Validation');
    if (!process.env.FIGMA_ACCESS_TOKEN) {
      errors++;
      log('FIGMA_ACCESS_TOKEN not set, skipping API checks', 'error');
    } else {
      log('Figma API validation not yet implemented (Phase 1)', 'warn');
      warnings++;
    }
  }

  // Summary
  header('📊 Summary');
  console.log(`Screens:    ${mapping.screens?.length || 0} defined`);
  console.log(`Components: ${mapping.components?.length || 0} defined`);
  console.log(`${colors.green}Passed:     ${passed}${colors.reset}`);
  console.log(`${colors.yellow}Warnings:   ${warnings}${colors.reset}`);
  console.log(`${colors.red}Errors:     ${errors}${colors.reset}`);

  // Determine exit code
  const strictMode = mapping.validationRules?.strictMode || false;

  if (errors > 0) {
    if (strictMode) {
      console.log(`\n${colors.red}${colors.bold}Status: ❌ FAIL (strict mode)${colors.reset}`);
      process.exit(1);
    } else {
      console.log(`\n${colors.yellow}${colors.bold}Status: ⚠️  WARN (non-strict mode)${colors.reset}`);
      process.exit(isCI ? 0 : 2);
    }
  } else if (warnings > 0) {
    console.log(`\n${colors.yellow}${colors.bold}Status: ⚠️  PASS with warnings${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${colors.green}${colors.bold}Status: ✅ PASS${colors.reset}`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`${colors.red}${colors.bold}Fatal error:${colors.reset}`, err);
  process.exit(2);
});
