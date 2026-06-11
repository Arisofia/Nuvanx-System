#!/usr/bin/env node
'use strict';

/**
 * Production E2E Wrapper
 *
 * Delegates to health-check-nuvanx.ts using tsx without shell interpolation.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'health-check-nuvanx.ts');
const runner = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(runner, ['tsx', scriptPath], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error('[production-e2e] Failed to launch health check:', result.error.message);
  process.exit(1);
}

process.exit(result.status || 0);
