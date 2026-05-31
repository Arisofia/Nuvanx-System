/**
 * Production E2E Wrapper
 * 
 * This script is called by the production:e2e npm task.
 * It delegates to health-check-nuvanx.ts using tsx.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'health-check-nuvanx.ts');

const result = spawnSync('npx', ['tsx', scriptPath], {
  stdio: 'inherit',
  shell: true
});

process.exit(result.status || 0);
