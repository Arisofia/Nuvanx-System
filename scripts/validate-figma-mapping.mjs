#!/usr/bin/env node
/**
 * validate-figma-mapping.mjs
 *
 * ESM entry-point wrapper for the Figma validation script.
 * Delegates to the CommonJS implementation at scripts/validate-figma-mapping.js,
 * which contains the full validation logic.
 *
 * Usage (equivalent to calling the .js file directly):
 *   node scripts/validate-figma-mapping.mjs
 *   node scripts/validate-figma-mapping.mjs --ci
 *   FIGMA_ACCESS_TOKEN=<token> node scripts/validate-figma-mapping.mjs --api-check
 *
 * See scripts/validate-figma-mapping.js for full documentation.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Forward all arguments to the CommonJS implementation
process.argv.splice(1, 1, resolve(__dirname, 'validate-figma-mapping.js'));
require('./validate-figma-mapping.js');
