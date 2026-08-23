import { test, expect } from '@playwright/test';

const CONTROL_CENTRE_ROUTES = [
  { path: '/dashboard', label: 'Dashboard', heading: 'Dashboard' },
  { path: '/traceability', label: 'Trazabilidad', heading: 'Trazabilidad' },
  { path: '/reports', label: 'Reportes', heading: 'Reportes' },
  { path: '/reports/lead-audit', label: 'Auditoría leads', heading: 'Auditoría de leads' },
  { path: '/live', label: 'Live', heading: 'Panel en vivo' },
  { path: '/crm', label: 'CRM', heading: 'CRM' },
  { path: '/marketing', label: 'Marketing', heading: 'Marketing · Meta Ads' },
  { path: '/financials', label: 'Finanzas', heading: 'Auditoría operativa Doctoralia' },
  { path: '/intelligence', label: 'Inteligencia', heading: 'Inteligencia' },
  { path: '/integrations', label: 'Integraciones', heading: 'Integraciones' },
  { path: '/ai', label: 'IA', heading: 'Capa IA' },
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('authenticated Control Centre routes load without runtime or server errors', async ({ page }) => {
  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD are required for the production Control Centre smoke test.');
  }

  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('response', (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  // Prevent production mutations and costs on the AI route
  await page.route('**/api/ai/**', route => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Mocked response for E2E', content: 'Mocked content', data: { success: true } })
      });
    } else {
      route.continue();
    }
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15_000 });
  await expect(page.getByText(/centro de control/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();

  for (const route of CONTROL_CENTRE_ROUTES) {
    pageErrors.length = 0;
    serverErrors.length = 0;

    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}/?$`));
    await expect(page.getByText(/centro de control/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${escapeRegExp(route.label)}$`, 'i') })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(route.heading), 'i') }).first()).toBeVisible();

    // Allow each route's first authenticated data requests and lazy bundle to settle.
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    await expect(page.getByText(/error inesperado/i)).toHaveCount(0);
    await expect(page.getByText(/ha ocurrido un error cargando esta sección/i)).toHaveCount(0);

    expect(pageErrors, `${route.path} emitted page runtime errors`).toEqual([]);
    expect(serverErrors, `${route.path} received server-side 5xx responses`).toEqual([]);
  }
});