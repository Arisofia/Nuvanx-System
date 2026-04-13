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
    // Check if route is defined in App.jsx.
    // Match both path="route" and path="/route" (with or without leading slash).
    const bare = screen.route.replace(/^\//, '');
    const routePattern = new RegExp(`path=["']\/?${bare}["']`);
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
    // Placeholder value 'REPLACE_WITH_NODE_ID' is treated as missing (warning), not invalid (error)
    const nodeIdPattern = /^\d+:\d+$/;
    return item.figmaNodeId &&
      item.figmaNodeId !== 'REPLACE_WITH_NODE_ID' &&
      !nodeIdPattern.test(item.figmaNodeId);
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

/**
 * Phase 1 – Figma REST API validation.
 * Verifies that the configured file is accessible and that every non-placeholder
 * figmaNodeId in the mapping actually exists inside the Figma document.
 *
 * Uses Node.js built-in `https` module so no extra dependencies are required.
 */
async function validateFigmaAPI(mapping) {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  const fileKey = mapping.figma?.fileKey;

  if (!fileKey) {
    errors++;
    log('figma.fileKey is missing from the mapping – cannot run API checks', 'error');
    return;
  }

  // ── Helper: make a GET request to the Figma API ──────────────────────────
  function figmaGet(pathStr) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const options = {
        hostname: 'api.figma.com',
        path: pathStr,
        method: 'GET',
        headers: { 'X-Figma-Token': token },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Figma API responded with ${res.statusCode}: ${body}`));
          } else {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Failed to parse Figma API response: ${e.message}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  // ── 1. Verify the token is valid via /v1/me ──────────────────────────────
  log('Verifying Figma token via /v1/me …', 'info');
  try {
    const me = await figmaGet('/v1/me');
    passed++;
    log(`Token valid – authenticated as: ${me.handle || me.email || 'unknown'}`, 'pass');
  } catch (err) {
    errors++;
    log(`Figma token validation failed: ${err.message}`, 'error');
    return;
  }

  // ── 2. Verify the file is accessible ─────────────────────────────────────
  log(`Fetching Figma file ${fileKey} …`, 'info');
  let fileData;
  try {
    fileData = await figmaGet(`/v1/files/${fileKey}?depth=1`);
    passed++;
    log(`Figma file accessible: "${fileData.name}"`, 'pass');
  } catch (err) {
    // Figma Make files return 400 "File type not supported by this endpoint".
    // This is expected – treat it as a warning, not a hard error.
    if (err.message.includes('400') && err.message.includes('not supported')) {
      warnings++;
      log('This is a Figma Make file – /v1/files endpoint is not supported for Make files.', 'warn');
      log('Node ID validation via API is not available for Figma Make projects.', 'warn');
      log('To get node IDs: open the file in Figma Make, inspect each frame and copy the node-id from the URL.', 'info');
    } else {
      errors++;
      log(`Cannot access Figma file: ${err.message}`, 'error');
    }
    return;
  }

  // ── 2. Collect non-placeholder node IDs ──────────────────────────────────
  const allItems = [
    ...(mapping.screens || []),
    ...(mapping.components || []),
  ];

  const nodeIdPattern = /^\d+:\d+$/;
  const idsToCheck = allItems
    .filter(item => item.figmaNodeId && nodeIdPattern.test(item.figmaNodeId))
    .map(item => ({ name: item.name, id: item.figmaNodeId }));

  const placeholderCount = allItems.filter(
    item => !item.figmaNodeId || item.figmaNodeId === 'REPLACE_WITH_NODE_ID'
  ).length;

  if (placeholderCount > 0) {
    warnings++;
    log(
      `${placeholderCount} item(s) still use placeholder node IDs – open the Figma file, ` +
      'right-click a frame → Copy link, then extract the node-id parameter',
      'warn'
    );
  }

  if (idsToCheck.length === 0) {
    warnings++;
    log('No real figmaNodeIds to validate via API (all are placeholders)', 'warn');
    return;
  }

  // ── 3. Validate node IDs via /v1/files/:key/nodes ────────────────────────
  const idList = [...new Set(idsToCheck.map(i => i.id))].join(',');
  log(`Validating ${idsToCheck.length} node ID(s) against Figma API …`, 'info');

  let nodesData;
  try {
    nodesData = await figmaGet(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(idList)}`);
  } catch (err) {
    errors++;
    log(`Node ID lookup failed: ${err.message}`, 'error');
    return;
  }

  const returnedIds = new Set(Object.keys(nodesData.nodes || {}));
  const missing = idsToCheck.filter(item => !returnedIds.has(item.id));
  const found = idsToCheck.filter(item => returnedIds.has(item.id));

  if (found.length > 0) {
    passed++;
    log(`${found.length} node ID(s) confirmed in Figma file`, 'pass');
    found.forEach(item => log(`  ✓ ${item.name} (${item.id})`, 'pass'));
  }

  if (missing.length > 0) {
    errors++;
    log(`${missing.length} node ID(s) not found in Figma file:`, 'error');
    missing.forEach(item => log(`  ✗ ${item.name}: ${item.id}`, 'error'));
  }
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

  // Figma API validation (Phase 1)
  if (apiCheck) {
    header('🔌 Figma API Validation');
    if (!process.env.FIGMA_ACCESS_TOKEN) {
      errors++;
      log('FIGMA_ACCESS_TOKEN not set. Export it before running --api-check', 'error');
    } else {
      await validateFigmaAPI(mapping);
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
