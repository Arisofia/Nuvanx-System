import { defineConfig, devices } from '@playwright/test';

const productionBaseURL = process.env.PRODUCTION_E2E_URL?.trim();
const baseURL = productionBaseURL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.playwright.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
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
