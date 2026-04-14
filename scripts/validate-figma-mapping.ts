#!/usr/bin/env node

/**
 * Figma ↔ GitHub Validation Script (TypeScript)
 *
 * Validates that the component mapping file is well-formed and that all
 * referenced code files exist in the repository.
 *
 * Usage:
 *   npx tsx scripts/validate-figma-mapping.ts              # Run locally
 *   npx tsx scripts/validate-figma-mapping.ts --ci         # Run in CI (exit 0 even on warnings)
 *   FIGMA_ACCESS_TOKEN=<token> npx tsx scripts/validate-figma-mapping.ts --api-check
 *
 * Exit codes:
 *   0 - Validation passed (or warnings in non-strict mode)
 *   1 - Validation failed (strict mode)
 *   2 - Critical error (file not found, invalid JSON)
 */

import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
} as const;

type ColorKey = keyof typeof colors;
type LogType = 'error' | 'warn' | 'pass' | 'info';

// ── Types ────────────────────────────────────────────────────────────────────

interface MappingItem {
  name: string;
  figmaNodeId: string;
  figmaUrl: string;
  component: string;
  status: string;
  lastValidated?: string;
  notes?: string;
  designReviewRequired?: boolean;
  route?: string;
  variants?: string[];
  props?: Record<string, string>;
  a11y?: string;
}

interface FigmaConfig {
  fileKey: string;
  fileUrl: string;
  lastSync: string;
  notes?: string;
}

interface ValidationRules {
  strictMode?: boolean;
  requireFigmaNodeIds?: boolean;
  requireLastValidated?: boolean;
  allowMissingDesigns?: boolean;
  warnOnStaleMappings?: boolean;
  staleDays?: number;
}

interface FigmaMapping {
  version?: string;
  repository?: string;
  figma: FigmaConfig;
  screens?: MappingItem[];
  components?: MappingItem[];
  validationRules?: ValidationRules;
  metadata?: Record<string, unknown>;
}

// ── State ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isCI = args.includes('--ci');
const apiCheck = args.includes('--api-check');

const repoRoot = path.resolve(__dirname, '..');
const mappingFilePath = path.join(repoRoot, 'docs', 'figma-component-map.json');
const appFilePath = path.join(repoRoot, 'frontend', 'src', 'App.jsx');

let errors = 0;
let warnings = 0;
let passed = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(message: string, type: LogType = 'info'): void {
  const prefix: Record<LogType, string> = {
    error: `${colors.red}[ERROR]${colors.reset}`,
    warn: `${colors.yellow}[WARN]${colors.reset}`,
    pass: `${colors.green}[PASS]${colors.reset}`,
    info: `${colors.cyan}[INFO]${colors.reset}`,
  };
  console.log(`${prefix[type]} ${message}`);
}

function header(message: string): void {
  console.log(`\n${colors.bold}${colors.cyan}${message}${colors.reset}`);
  console.log('━'.repeat(50));
}

function validateJSON(filePath: string): FigmaMapping | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content) as FigmaMapping;
    passed++;
    log('JSON schema valid', 'pass');
    return data;
  } catch (err) {
    errors++;
    log(`Invalid JSON: ${(err as Error).message}`, 'error');
    return null;
  }
}

function validateRequiredFields(
  obj: Record<string, unknown>,
  requiredFields: string[],
  objName: string,
): boolean {
  const missing = requiredFields.filter((field) => {
    const value = field.split('.').reduce<unknown>((o, key) => {
      return o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined;
    }, obj);
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

function validateFileExistence(items: MappingItem[], type: string): boolean {
  const missingFiles: Array<{ name: string; path: string }> = [];

  for (const item of items) {
    const filePath = path.join(repoRoot, item.component);
    if (!fs.existsSync(filePath)) {
      missingFiles.push({ name: item.name, path: item.component });
    }
  }

  if (missingFiles.length > 0) {
    errors++;
    log(`${missingFiles.length} ${type} file(s) missing:`, 'error');
    for (const f of missingFiles) {
      log(`  - ${f.name}: ${f.path}`, 'error');
    }
    return false;
  }

  passed++;
  log(`All ${type} files exist (${items.length}/${items.length})`, 'pass');
  return true;
}

function validateRoutes(screens: MappingItem[]): void {
  if (!fs.existsSync(appFilePath)) {
    warnings++;
    log('App.jsx not found, skipping route validation', 'warn');
    return;
  }

  const appContent = fs.readFileSync(appFilePath, 'utf8');
  const missingRoutes: string[] = [];

  for (const screen of screens) {
    if (!screen.route) continue;
    const bare = screen.route.replace(/^\//, '');
    const routePattern = new RegExp(`path=["']\/?${bare}["']`);
    if (!routePattern.test(appContent)) {
      missingRoutes.push(screen.route);
    }
  }

  if (missingRoutes.length > 0) {
    warnings++;
    log(`${missingRoutes.length} route(s) not found in App.jsx: ${missingRoutes.join(', ')}`, 'warn');
  } else {
    passed++;
    log(`All routes match App.jsx (${screens.length}/${screens.length})`, 'pass');
  }
}

function checkDuplicateNames(items: MappingItem[], type: string): boolean {
  const names = items.map((item) => item.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

  if (duplicates.length > 0) {
    errors++;
    log(`Duplicate ${type} names found: ${[...new Set(duplicates)].join(', ')}`, 'error');
    return false;
  }

  passed++;
  log(`No duplicate ${type} names`, 'pass');
  return true;
}

function checkStaleness(mapping: FigmaMapping): void {
  const lastSync = new Date(mapping.figma.lastSync);
  const now = new Date();
  const daysSinceSync = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60 * 60 * 24));
  const threshold = mapping.validationRules?.staleDays ?? 30;

  if (daysSinceSync > threshold) {
    warnings++;
    log(`Mapping last synced ${daysSinceSync} days ago (threshold: ${threshold} days)`, 'warn');
  } else {
    passed++;
    log(`Mapping is up to date (${daysSinceSync} days old)`, 'pass');
  }
}

function validateFigmaNodeIds(items: MappingItem[], type: string): boolean {
  const nodeIdPattern = /^\d+:\d+$/;

  const invalidNodeIds = items.filter(
    (item) =>
      item.figmaNodeId &&
      item.figmaNodeId !== 'REPLACE_WITH_NODE_ID' &&
      !nodeIdPattern.test(item.figmaNodeId),
  );

  if (invalidNodeIds.length > 0) {
    errors++;
    log(`${invalidNodeIds.length} ${type} have invalid figmaNodeId format:`, 'error');
    for (const item of invalidNodeIds) {
      log(`  - ${item.name}: ${item.figmaNodeId}`, 'error');
    }
    return false;
  }

  const missingNodeIds = items.filter(
    (item) => !item.figmaNodeId || item.figmaNodeId === 'REPLACE_WITH_NODE_ID',
  );

  if (missingNodeIds.length > 0) {
    warnings++;
    log(`${missingNodeIds.length} ${type} missing figmaNodeId (placeholder values):`, 'warn');
    for (const item of missingNodeIds) {
      log(`  - ${item.name}`, 'warn');
    }
  }

  passed++;
  return true;
}

// ── Figma API helpers ─────────────────────────────────────────────────────────

function figmaGet(token: string, pathStr: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.figma.com',
      path: pathStr,
      method: 'GET',
      headers: { 'X-Figma-Token': token },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Figma API responded with ${res.statusCode}: ${body}`));
        } else {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse Figma API response: ${(e as Error).message}`));
          }
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Phase 1 – Figma REST API validation.
 * Verifies that the configured file is accessible and that every non-placeholder
 * figmaNodeId in the mapping actually exists inside the Figma document.
 */
async function validateFigmaAPI(mapping: FigmaMapping): Promise<void> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  const fileKey = mapping.figma?.fileKey;

  if (!token) {
    errors++;
    log('FIGMA_ACCESS_TOKEN not set. Export it before running --api-check', 'error');
    return;
  }

  if (!fileKey) {
    errors++;
    log('figma.fileKey is missing from the mapping – cannot run API checks', 'error');
    return;
  }

  // 1. Verify the token is valid via /v1/me
  log('Verifying Figma token via /v1/me …', 'info');
  try {
    const me = await figmaGet(token, '/v1/me') as { handle?: string; email?: string };
    passed++;
    log(`Token valid – authenticated as: ${me.handle ?? me.email ?? 'unknown'}`, 'pass');
  } catch (err) {
    errors++;
    log(`Figma token validation failed: ${(err as Error).message}`, 'error');
    return;
  }

  // 2. Verify the file is accessible
  log(`Fetching Figma file ${fileKey} …`, 'info');
  try {
    const fileData = await figmaGet(token, `/v1/files/${fileKey}?depth=1`) as { name: string };
    passed++;
    log(`Figma file accessible: "${fileData.name}"`, 'pass');
  } catch (err) {
    const message = (err as Error).message;
    // Figma Make files return 400 "File type not supported by this endpoint".
    if (message.includes('400') && message.includes('not supported')) {
      warnings++;
      log('This is a Figma Make file – /v1/files endpoint is not supported for Make files.', 'warn');
      log('Node ID validation via API is not available for Figma Make projects.', 'warn');
      log(
        'To get node IDs: open the file in Figma Make, inspect each frame and copy the node-id from the URL.',
        'info',
      );
    } else {
      errors++;
      log(`Cannot access Figma file: ${message}`, 'error');
    }
    return;
  }

  // 3. Collect non-placeholder node IDs
  const allItems = [...(mapping.screens ?? []), ...(mapping.components ?? [])];
  const nodeIdPattern = /^\d+:\d+$/;
  const idsToCheck = allItems
    .filter((item) => item.figmaNodeId && nodeIdPattern.test(item.figmaNodeId))
    .map((item) => ({ name: item.name, id: item.figmaNodeId }));

  const placeholderCount = allItems.filter(
    (item) => !item.figmaNodeId || item.figmaNodeId === 'REPLACE_WITH_NODE_ID',
  ).length;

  if (placeholderCount > 0) {
    warnings++;
    log(
      `${placeholderCount} item(s) still use placeholder node IDs – open the Figma file, ` +
        'right-click a frame → Copy link, then extract the node-id parameter',
      'warn',
    );
  }

  if (idsToCheck.length === 0) {
    warnings++;
    log('No real figmaNodeIds to validate via API (all are placeholders)', 'warn');
    return;
  }

  // 4. Validate node IDs via /v1/files/:key/nodes
  const idList = [...new Set(idsToCheck.map((i) => i.id))].join(',');
  log(`Validating ${idsToCheck.length} node ID(s) against Figma API …`, 'info');

  let nodesData: { nodes?: Record<string, unknown> };
  try {
    nodesData = (await figmaGet(
      token,
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(idList)}`,
    )) as { nodes?: Record<string, unknown> };
  } catch (err) {
    errors++;
    log(`Node ID lookup failed: ${(err as Error).message}`, 'error');
    return;
  }

  const returnedIds = new Set(Object.keys(nodesData.nodes ?? {}));
  const missing = idsToCheck.filter((item) => !returnedIds.has(item.id));
  const found = idsToCheck.filter((item) => returnedIds.has(item.id));

  if (found.length > 0) {
    passed++;
    log(`${found.length} node ID(s) confirmed in Figma file`, 'pass');
    for (const item of found) {
      log(`  ✓ ${item.name} (${item.id})`, 'pass');
    }
  }

  if (missing.length > 0) {
    errors++;
    log(`${missing.length} node ID(s) not found in Figma file:`, 'error');
    for (const item of missing) {
      log(`  ✗ ${item.name}: ${item.id}`, 'error');
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  header('🎨 Figma Validation Report');

  if (!fs.existsSync(mappingFilePath)) {
    log('Mapping file not found: docs/figma-component-map.json', 'error');
    log('Create docs/figma-component-map.json with your real Figma file key and node IDs', 'info');
    errors++;
    process.exit(2);
  }

  log('Validating JSON structure...', 'info');
  const mapping = validateJSON(mappingFilePath);
  if (!mapping) {
    process.exit(2);
  }

  log('Checking required fields...', 'info');
  validateRequiredFields(mapping as unknown as Record<string, unknown>, [
    'version',
    'repository',
    'figma.fileKey',
    'figma.fileUrl',
    'figma.lastSync',
    'screens',
    'components',
  ], 'Mapping file');

  if (mapping.screens && mapping.screens.length > 0) {
    header(`📱 Validating Screens (${mapping.screens.length})`);

    mapping.screens.forEach((screen, index) => {
      validateRequiredFields(screen as unknown as Record<string, unknown>, [
        'name',
        'route',
        'figmaNodeId',
        'figmaUrl',
        'component',
        'status',
      ], `Screen #${index + 1} (${screen.name ?? 'unnamed'})`);
    });

    validateFileExistence(mapping.screens, 'screen');
    validateRoutes(mapping.screens);
    checkDuplicateNames(mapping.screens, 'screen');
    validateFigmaNodeIds(mapping.screens, 'screens');
  } else {
    warnings++;
    log('No screens defined in mapping', 'warn');
  }

  if (mapping.components && mapping.components.length > 0) {
    header(`🧩 Validating Components (${mapping.components.length})`);

    mapping.components.forEach((component, index) => {
      validateRequiredFields(component as unknown as Record<string, unknown>, [
        'name',
        'figmaNodeId',
        'figmaUrl',
        'component',
        'status',
      ], `Component #${index + 1} (${component.name ?? 'unnamed'})`);
    });

    validateFileExistence(mapping.components, 'component');
    checkDuplicateNames(mapping.components, 'component');
    validateFigmaNodeIds(mapping.components, 'components');
  } else {
    warnings++;
    log('No components defined in mapping', 'warn');
  }

  header('📅 Checking Freshness');
  checkStaleness(mapping);

  if (apiCheck) {
    header('🔌 Figma API Validation');
    await validateFigmaAPI(mapping);
  }

  header('📊 Summary');
  console.log(`Screens:    ${mapping.screens?.length ?? 0} defined`);
  console.log(`Components: ${mapping.components?.length ?? 0} defined`);
  console.log(`${colors.green}Passed:     ${passed}${colors.reset}`);
  console.log(`${colors.yellow}Warnings:   ${warnings}${colors.reset}`);
  console.log(`${colors.red}Errors:     ${errors}${colors.reset}`);

  const strictMode = mapping.validationRules?.strictMode ?? false;

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

main().catch((err: Error) => {
  console.error(`${colors.red}${colors.bold}Fatal error:${colors.reset}`, err);
  process.exit(2);
});
