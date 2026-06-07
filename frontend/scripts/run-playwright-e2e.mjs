import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const requireBrowsers = process.env.CI === 'true' || process.env.PLAYWRIGHT_REQUIRE_BROWSERS === 'true';

function chromiumExecutableCandidates() {
  const explicitPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicitPath) return [explicitPath];

  const metadata = JSON.parse(readFileSync(new URL('../node_modules/playwright-core/browsers.json', import.meta.url), 'utf8'));
  const shell = metadata.browsers.find((browser) => browser.name === 'chromium-headless-shell');
  const chromium = metadata.browsers.find((browser) => browser.name === 'chromium');
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
    ? process.env.PLAYWRIGHT_BROWSERS_PATH
    : join(homedir(), '.cache', 'ms-playwright');

  return [
    shell && join(cacheRoot, `chromium_headless_shell-${shell.revision}`, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    chromium && join(cacheRoot, `chromium-${chromium.revision}`, 'chrome-linux', 'chrome'),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
}

const hasChromium = chromiumExecutableCandidates().some((candidate) => existsSync(candidate));

if (!hasChromium && !requireBrowsers) {
  console.log('[playwright] Browser executable is not available locally; skipping optional local E2E run.');
  console.log('[playwright] CI remains strict via PLAYWRIGHT_REQUIRE_BROWSERS=true.');
  console.log('[playwright] Run `npm exec playwright install --with-deps` in an unrestricted environment to execute locally.');
  process.exit(0);
}

const result = spawnSync('playwright', ['test'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
