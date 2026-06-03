import { test, expect } from '@playwright/test';

test('login page loads', async ({ page }) => {
  await page.goto('/');
  // Since we are not authenticated, we should be redirected to /login or see Login text
  await expect(page).toHaveURL(/.*login/);
  await expect(page.locator('h2')).toContainText(/Bienvenido/i);
});
