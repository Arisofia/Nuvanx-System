#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['jest', '--runInBand', '--forceExit'],
  {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
  }
);

if (result.error) {
  console.error('[test-runner] Failed to start Jest:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
