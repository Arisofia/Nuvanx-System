import { defineConfig, devices } from '@playwright/test';

const configuredProductionBaseURL = process.env.PRODUCTION_E2E_URL?.trim();
const canonicalCiBaseURL =
  process.env.CANONICAL_PRODUCTION_E2E_URL?.trim() ||
  'https://nuvanx-frontend.jenineferderas.workers.dev';

// CI must validate the canonical production runtime, never a legacy Vercel
// deployment left behind in a repository secret. Local runs may still target an
// explicitly supplied URL for troubleshooting.
const productionBaseURL = process.env.CI ? canonicalCiBaseURL : configuredProductionBaseURL;
const baseURL = productionBaseURL || 'http://localhost:5173';

if (process.env.CI) {
  process.env.PRODUCTION_E2E_URL = canonicalCiBaseURL;
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.playwright.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: productionBaseURL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
