#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(new URL('../.github/workflows/manual-maintenance.yml', import.meta.url));
const workflow = readFileSync(workflowPath, 'utf8');

const requiredResidualFunctions = [
  'meta-asset-audit-temp',
  'meta-legacy-retire-temp',
  'google-gtm-audit-temp',
  'google-gtm-sa-audit-temp',
  'google-sa-shape-temp',
  'google-gtm-enable-temp',
  'meta-qa-suppression-proof-temp',
];

const retiredBlock = workflow.match(/retired=\(\n([\s\S]*?)\n\s*\)/)?.[1] ?? '';
const missing = requiredResidualFunctions.filter((functionName) => !retiredBlock.includes(functionName));

if (missing.length > 0) {
  console.error(`RETIRED_EDGE_INVENTORY=FAIL missing=${missing.join(',')}`);
  process.exit(1);
}

const requiredGuards = [
  'test "$TRUSTED_SHA" = "$GITHUB_SHA"',
  'supabase functions delete "$function_name"',
  'Retired Edge Function still registered',
];
for (const guard of requiredGuards) {
  if (!workflow.includes(guard)) {
    console.error(`RETIRED_EDGE_INVENTORY=FAIL missing_guard=${guard}`);
    process.exit(1);
  }
}

console.log(`RETIRED_EDGE_INVENTORY=PASS residual_count=${requiredResidualFunctions.length}`);
