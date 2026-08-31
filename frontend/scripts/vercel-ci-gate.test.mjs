import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTriggerPath, evaluateChangedFiles } from './vercel-ci-gate.mjs';

test('isTriggerPath identifies frontend and root configuration changes', () => {
  // Positive trigger cases (should trigger a frontend build)
  assert.equal(isTriggerPath('.vercelignore'), true);
  assert.equal(isTriggerPath('./.vercelignore'), true);
  assert.equal(isTriggerPath('vercel.json'), true);
  assert.equal(isTriggerPath('frontend/vercel.json'), true);
  assert.equal(isTriggerPath('package.json'), true);
  assert.equal(isTriggerPath('package-lock.json'), true);
  assert.equal(isTriggerPath('vite.config.ts'), true);
  assert.equal(isTriggerPath('frontend/vite.config.ts'), true);
  assert.equal(isTriggerPath('frontend/src/App.tsx'), true);
  assert.equal(isTriggerPath('src/App.tsx'), true);
  assert.equal(isTriggerPath('public/favicon.ico'), true);
  assert.equal(isTriggerPath('frontend/public/favicon.ico'), true);
  assert.equal(isTriggerPath('index.html'), true);
  assert.equal(isTriggerPath('.env.production'), true);
  assert.equal(isTriggerPath('frontend/.env.local'), true);
  assert.equal(isTriggerPath('scripts/vercel-ci-gate.mjs'), true);
  assert.equal(isTriggerPath('frontend/scripts/vercel-ci-gate.mjs'), true);

  // Negative trigger cases (should NOT trigger a frontend build)
  assert.equal(isTriggerPath('supabase/migrations/20260831090000_test.sql'), false);
  assert.equal(isTriggerPath('backend/server.ts'), false);
  assert.equal(isTriggerPath('docs/operations/vercel.md'), false);
  assert.equal(isTriggerPath('scripts/populate-doctoralia-appointments.js'), false);
  assert.equal(isTriggerPath('scripts/lib/meta-rsv26.js'), false);
  assert.equal(isTriggerPath(''), false);
  assert.equal(isTriggerPath(null), false);
});

test('evaluateChangedFiles correctly processes multi-line git diff output', () => {
  const sqlOnlyDiff = `
supabase/migrations/20260831090000_fix_source_to_cash_deleted_at_filter.sql
supabase/migrations/20260831090100_fix_master_pacientes_trazabilidad_use_dai.sql
supabase/migrations/20260831090200_fix_revops_stale_dispatch_cleanup.sql
`.trim();
  assert.equal(evaluateChangedFiles(sqlOnlyDiff), false);

  const mixedDiffWithVercelIgnore = `
.vercelignore
supabase/migrations/20260831090000_fix_source_to_cash_deleted_at_filter.sql
`.trim();
  assert.equal(evaluateChangedFiles(mixedDiffWithVercelIgnore), true);

  const frontendOnlyDiff = `
frontend/src/pages/CRM.tsx
frontend/src/components/layout/Sidebar.tsx
`.trim();
  assert.equal(evaluateChangedFiles(frontendOnlyDiff), true);

  const emptyDiff = '';
  assert.equal(evaluateChangedFiles(emptyDiff), false);
});
