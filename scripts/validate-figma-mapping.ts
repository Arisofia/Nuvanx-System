#!/usr/bin/env node

/**
 * Figma Component Mapping Validator
 * Validates the figma-component-map.json file for correctness
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPING_FILE = path.join(__dirname, '../docs/figma-component-map.json');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

type ColorKey = keyof typeof colors;

function log(message: string, color: ColorKey = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function validateNodeId(nodeId: string): boolean {
  // Valid formats: "1:2", "12:34", "123:456"
  const nodeIdPattern = /^\d+:\d+$/;
  return nodeIdPattern.test(nodeId);
}

function validateFilePath(filePath: string): boolean {
  const fullPath = path.join(__dirname, '..', filePath);
  return fs.existsSync(fullPath);
}

const PLACEHOLDER = 'REPLACE_WITH_NODE_ID';

interface ScreenEntry {
  name: string;
  figmaNodeId: string;
  component: string;
  notes?: string;
  [key: string]: unknown;
}

interface FigmaMapping {
  version?: string;
  figma?: {
    fileKey: string;
    fileUrl: string;
    lastSync: string;
    fileType?: string;
    apiSupported?: boolean;
  };
  screens?: ScreenEntry[];
  components?: ScreenEntry[];
}

function validateMapping() {
  log('\n🔍 Validating Figma Component Mapping...', 'cyan');
  log('━'.repeat(50), 'cyan');

  // Check if mapping file exists
  if (!fs.existsSync(MAPPING_FILE)) {
    log(`\n❌ Error: Mapping file not found at ${MAPPING_FILE}`, 'red');
    process.exit(1);
  }

  // Read and parse JSON
  let mapping: FigmaMapping;
  try {
    const content = fs.readFileSync(MAPPING_FILE, 'utf8');
    mapping = JSON.parse(content);
    log('\n✅ JSON file is valid', 'green');
  } catch (error) {
    log(`\n❌ Error parsing JSON: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  let hasErrors = false;
  let hasWarnings = false;

  // Validate Figma file info
  log('\n📋 Figma File Information:', 'blue');
  if (!mapping.figma?.fileKey || mapping.figma.fileKey === 'YOUR_FIGMA_FILE_KEY_HERE') {
    log('  ⚠️  Warning: Figma fileKey not configured', 'yellow');
    hasWarnings = true;
  } else {
    log(`  ✓ File Key: ${mapping.figma.fileKey}`, 'green');

    if (mapping.figma.fileType === 'make' || mapping.figma.apiSupported === false) {
      log('  ⚠️  WARNING: Este es un archivo Figma Make', 'yellow');
      log('  ℹ️  La API REST de Figma NO soporta archivos Make', 'cyan');
      log('  ℹ️  Node IDs deben obtenerse manualmente (Copy link)', 'cyan');
      hasWarnings = true;
    }
  }

  function validateEntry(entry: ScreenEntry, type: 'Screen' | 'Component') {
    const label = `${type}: ${entry.name}`;
    log(`\n  ${label}`, 'cyan');

    // Validate node ID
    if (!entry.figmaNodeId) {
      log(`    ❌ Missing figmaNodeId`, 'red');
      hasErrors = true;
    } else if (entry.figmaNodeId === PLACEHOLDER) {
      log(`    ⚠️  Node ID pendiente — usar "Copy link" en Figma Make`, 'yellow');
      hasWarnings = true;
    } else if (!validateNodeId(entry.figmaNodeId)) {
      log(`    ❌ Invalid figmaNodeId format: "${entry.figmaNodeId}" (expected: "123:456")`, 'red');
      hasErrors = true;
    } else {
      log(`    ✓ Node ID: ${entry.figmaNodeId}`, 'green');
    }

    // Validate component file path
    if (!entry.component) {
      log(`    ❌ Missing component path`, 'red');
      hasErrors = true;
    } else if (!validateFilePath(entry.component)) {
      log(`    ❌ Component file not found: ${entry.component}`, 'red');
      hasErrors = true;
    } else {
      log(`    ✓ Component: ${entry.component}`, 'green');
    }
  }

  // Validate screens
  log('\n🖼️  Validating Screens:', 'blue');
  if (mapping.screens && mapping.screens.length > 0) {
    for (const screen of mapping.screens) {
      validateEntry(screen, 'Screen');
    }
  } else {
    log('  ⚠️  No screens defined', 'yellow');
    hasWarnings = true;
  }

  // Validate components
  log('\n🧩 Validating Components:', 'blue');
  if (mapping.components && mapping.components.length > 0) {
    for (const component of mapping.components) {
      validateEntry(component, 'Component');
    }
  } else {
    log('  ⚠️  No components defined', 'yellow');
    hasWarnings = true;
  }

  // Summary
  log('\n' + '━'.repeat(50), 'cyan');
  if (hasErrors) {
    log('\n❌ Validation Failed - Please fix errors above', 'red');
    process.exit(1);
  } else if (hasWarnings) {
    log('\n⚠️  Validation Passed with Warnings', 'yellow');
    process.exit(0);
  } else {
    log('\n✅ Validation Passed - All checks successful!', 'green');
    process.exit(0);
  }
}

// Run validation
validateMapping();
