import { existsSync } from 'node:fs';
import { test, expect, chromium } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

const hasChromiumBrowser = existsSync(chromium.executablePath());

test.describe('Authentication', () => {
  test.skip(!hasChromiumBrowser, `Playwright Chromium is not installed at ${chromium.executablePath()}`);
  test('should show error with invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('invalid@example.com', 'wrongpassword');
    
    // Check for error message
    await expect(page.getByText('Invalid login credentials')).toBeVisible();
  });

  test('should redirect to dashboard on successful login', async ({ page }) => {
    // This test requires real credentials from env vars
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;

    if (!email || !password) {
      test.skip('No E2E credentials provided');
      return;
    }

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    await loginPage.goto();
    await loginPage.login(email, password);
    
    await expect(page).toHaveURL(/.*dashboard/);
    await dashboardPage.isVisible();
  });
});
