import { test, expect } from '@playwright/test';

test('login page loads', async ({ page }) => {
  await page.goto('/');
  // Since we are not authenticated, the login UI may render at / or /login.
  await expect(page.locator('h2')).toContainText(/Bienvenido/i);
  await expect(page).toHaveURL(/(?:\/|\/login)\/?$/);
});
