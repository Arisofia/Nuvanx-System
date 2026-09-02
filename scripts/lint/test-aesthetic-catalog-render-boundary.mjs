#!/usr/bin/env node
/**
 * Aesthetic Catalog/Renderer Boundary Test
 *
 * Enforces architectural separation between catalog API and renderer.
 *
 * @package nuvanx-medical
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const THEME_ROOT = process.cwd();
const INC_DIR = join(THEME_ROOT, 'wp-content/themes/nuvanx-medical/inc');

const CATALOG_FILE = join(INC_DIR, 'nvx-aesthetic-treatment-catalog.php');
const RENDERER_FILE = join(INC_DIR, 'nvx-aesthetic-treatment-pages.php');
const SCHEMA_FILE = join(INC_DIR, 'nvx-aesthetic-treatment-schema.php');
const CATALOG_JSON = join(INC_DIR, 'data/aesthetic-treatment-pages.json');

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`PASS: ${message}`);
  }
}

function assertNot(condition, message) {
  assert(!condition, message);
}

// Test 1: Catalog file exists
assert(existsSync(CATALOG_FILE), 'AESTHETIC_CATALOG_FILE_PRESENT');

// Test 2: Catalog has strict types
const catalogContent = readFileSync(CATALOG_FILE, 'utf8');
assert(
  catalogContent.includes('declare(strict_types=1);'),
  'AESTHETIC_CATALOG_STRICT_TYPES'
);

// Test 3: Catalog owns catalog API
assert(
  catalogContent.includes('function nvx_aesthetic_treatment_catalog()'),
  'AESTHETIC_CATALOG_OWNS_CATALOG'
);

// Test 4: Catalog owns current_key resolver
assert(
  catalogContent.includes('function nvx_aesthetic_treatment_current_key()'),
  'AESTHETIC_CATALOG_OWNS_CURRENT_KEY'
);

// Test 5: Catalog owns current_entry API
assert(
  catalogContent.includes('function nvx_aesthetic_treatment_entry('),
  'AESTHETIC_CATALOG_OWNS_CURRENT_ENTRY'
);

// Test 6: Catalog has no require_once
assertNot(
  catalogContent.includes('require_once'),
  'AESTHETIC_CATALOG_NO_REQUIRE'
);

// Test 7: Catalog has no add_action
assertNot(
  catalogContent.includes('add_action'),
  'AESTHETIC_CATALOG_NO_ADD_ACTION'
);

// Test 8: Catalog has no add_filter
assertNot(
  catalogContent.includes('add_filter'),
  'AESTHETIC_CATALOG_NO_ADD_FILTER'
);

// Test 9: Catalog has no HTML rendering
assertNot(
  catalogContent.includes('<div') || catalogContent.includes('<section'),
  'AESTHETIC_CATALOG_NO_HTML'
);

// Test 10: Catalog has no DB writes
assertNot(
  catalogContent.includes('wp_insert_post') || catalogContent.includes('wp_update_post') || catalogContent.includes('update_post_meta'),
  'AESTHETIC_CATALOG_NO_DB_WRITE'
);

// Test 11: Renderer file exists
assert(existsSync(RENDERER_FILE), 'AESTHETIC_RENDERER_FILE_PRESENT');

const rendererContent = readFileSync(RENDERER_FILE, 'utf8');

// Test 12: Renderer does NOT define catalog
assertNot(
  rendererContent.includes('function nvx_aesthetic_treatment_catalog()'),
  'AESTHETIC_RENDERER_NO_CATALOG_DEFINITION'
);

// Test 13: Renderer does NOT define current_key
assertNot(
  rendererContent.includes('function nvx_aesthetic_treatment_current_key()'),
  'AESTHETIC_RENDERER_NO_CURRENT_KEY_DEFINITION'
);

// Test 14: Renderer does NOT define normalize_entry
assertNot(
  rendererContent.includes('function nvx_aesthetic_catalog_normalize_entry('),
  'AESTHETIC_RENDERER_NO_NORMALIZE_DEFINITION'
);

// Test 15: Renderer has no seeder
assertNot(
  rendererContent.includes('nvx_aesthetic_treatment_seed_pages'),
  'AESTHETIC_RENDERER_NO_SEEDER'
);

// Test 16: Renderer has no init action
assertNot(
  rendererContent.includes("add_action( 'init'"),
  'AESTHETIC_RENDERER_NO_INIT'
);

// Test 17: Schema file exists
assert(existsSync(SCHEMA_FILE), 'AESTHETIC_SCHEMA_FILE_PRESENT');

const schemaContent = readFileSync(SCHEMA_FILE, 'utf8');

// Test 18: Schema does NOT define FAQ catalog
assertNot(
  schemaContent.includes('nvx_aesthetic_treatment_faq_catalog'),
  'AESTHETIC_SCHEMA_NO_FAQ_OWNER'
);

// Test 19: Schema uses entry API (not full catalog)
assert(
  schemaContent.includes('nvx_aesthetic_treatment_entry('),
  'AESTHETIC_SCHEMA_USES_ENTRY_API'
);

// Test 20: Schema comment reflects correct ownership
assert(
  schemaContent.includes('FAQPage ownership belongs to nvx-schema-faq.php'),
  'AESTHETIC_SCHEMA_COMMENT_CORRECT'
);

// Test 21: JSON file exists
assert(existsSync(CATALOG_JSON), 'AESTHETIC_CATALOG_JSON_PRESENT');

// Test 22: Registry/catalog parity check
if (existsSync(CATALOG_JSON)) {
  const jsonContent = readFileSync(CATALOG_JSON, 'utf8');
  const catalogData = JSON.parse(jsonContent);
  
  const jsonSlugs = Object.values(catalogData).map(entry => entry.slug);
  
  // Expected Aesthetic routes from Page Registry
  const expectedSlugs = [
    'labios-acido-hialuronico-madrid',
    'rinomodelacion-sin-cirugia-madrid',
    'ojeras-surco-lagrimal-madrid',
    'bioestimuladores-colageno-madrid',
    'neuromoduladores-faciales-madrid',
    'acido-hialuronico-relleno-madrid'
  ];
  
  for (const slug of expectedSlugs) {
    assert(
      jsonSlugs.includes(slug),
      `AESTHETIC_REGISTRY_CATALOG_PARITY slug=${slug}`
    );
  }
}

if (failures > 0) {
  console.error(`ERROR: ${failures} boundary violations detected`);
  process.exit(1);
}

console.log('AESTHETIC_CATALOG_RENDER_BOUNDARY=PASS');
process.exit(0);
