#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');

const requiredPaths = [
  'supabase/functions/dashboard/**',
  'supabase/functions/agent-run/**',
  'supabase/functions/runtime-bootstrap/**',
  'supabase/functions/_shared/**',
];
for (const path of requiredPaths) {
  if (!workflow.includes(path)) throw new Error(`Missing standalone deploy path trigger: ${path}`);
}

const requiredDeploys = [
  'supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF"',
  'supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF"',
  'supabase functions deploy runtime-bootstrap --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt',
];
for (const command of requiredDeploys) {
  if (!workflow.includes(command)) throw new Error(`Missing standalone deploy command: ${command}`);
}

if (workflow.includes('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt')) {
  throw new Error('dashboard must keep JWT verification enabled');
}
if (workflow.includes('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt')) {
  throw new Error('agent-run must keep JWT verification enabled');
}

console.log('Standalone Edge deployment ownership contract passed.');
