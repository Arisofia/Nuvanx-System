import { test, expect } from '@playwright/test';

test('login page loads', async ({ page }) => {
  await page.goto('/');
  // Since we are not authenticated, we should see the Login view immediately
  // while the redirect effect catches up with the URL state.
  await expect(page.locator('h2')).toContainText(/Bienvenido/i);
  // Verify that we are on the login path
  await expect(page).toHaveURL(/.*login/);
});
