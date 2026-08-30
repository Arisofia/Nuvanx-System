import { test, expect } from '@playwright/test';

const CONTROL_CENTRE_ROUTES = [
  { path: '/dashboard', label: 'Centro', heading: 'Centro operativo de la clínica' },
  { path: '/traceability', label: 'Trazabilidad', heading: 'Trazabilidad' },
  { path: '/reports', label: 'Analítica', heading: 'Reportes' },
  { path: '/reports/lead-audit', label: 'Auditoría leads', heading: 'Auditoría de leads' },
  { path: '/live', label: 'Agenda', heading: 'Panel en vivo' },
  { path: '/crm', label: 'Pacientes', heading: 'CRM' },
  { path: '/marketing', label: 'Adquisición', heading: 'Marketing · Meta Ads' },
  { path: '/financials', label: 'Finanzas', heading: 'Auditoría operativa Doctoralia' },
  { path: '/intelligence', label: 'Inteligencia', heading: 'Inteligencia' },
  { path: '/integrations', label: 'Integraciones', heading: 'Integraciones' },
  { path: '/ai', label: 'Asistente IA', heading: 'Capa IA' },
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectedHeading(path: string, heading: string) {
  const againstProduction = Boolean(process.env.PRODUCTION_E2E_URL?.trim());

  // This smoke runs before deployment while targeting the currently deployed
  // production UI. During the one-release finance rename transition, accept
  // either the old deployed label or the new canonical label. Route, runtime
  // and 5xx gates remain strict. Remove the legacy label after production has
  // fully rolled forward.
  if (againstProduction && path === '/financials') {
    return /^(Finanzas verificadas|Auditoría operativa Doctoralia)$/i;
  }

  return new RegExp(`^${escapeRegExp(heading)}$`, 'i');
}

test('authenticated Control Centre routes load without runtime or server errors', async ({ page }) => {
  test.setTimeout(90_000);

  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD are required for the production Control Centre smoke test.');
  }

  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('requestfailed', request => {
    console.log(`[REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText}`);
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`[HTTP ${response.status()}] ${response.url()}`);
    }
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  // Prevent production mutations and costs on the AI route.
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

  try {
    await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15_000 });
  } catch (error) {
    const errorText = await page.locator('.bg-red-50').textContent().catch(() => null);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Control Centre login failed to redirect to /dashboard. Visible error: "${errorText?.trim() || 'none'}". Page summary: ${bodyText.replace(/\s+/g, ' ').slice(0, 300)}`, { cause: error });
  }

  await expect(page.getByRole('navigation', { name: /navegación principal/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('control-centre-overview')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /^Centro operativo de la clínica$/i })).toBeVisible({ timeout: 15_000 });

  for (const route of CONTROL_CENTRE_ROUTES) {
    pageErrors.length = 0;
    serverErrors.length = 0;

    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}/?$`));
    await expect(page.getByRole('navigation', { name: /navegación principal/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: new RegExp(`^${escapeRegExp(route.label)}$`, 'i') })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: expectedHeading(route.path, route.heading) }).first()).toBeVisible({ timeout: 15_000 });

    if (route.path === '/dashboard') {
      await expect(page.getByTestId('control-centre-overview')).toBeVisible({ timeout: 15_000 });
    }

    // Realtime/polling routes may never become network-idle. Observe a bounded
    // post-render window instead, while keeping pageerror and every 5xx strict.
    await page.waitForTimeout(1_000);

    await expect(page.getByText(/error inesperado/i)).toHaveCount(0);
    await expect(page.getByText(/ha ocurrido un error cargando esta sección/i)).toHaveCount(0);

    expect(pageErrors, `${route.path} emitted page runtime errors`).toEqual([]);
    expect(serverErrors, `${route.path} received server-side 5xx responses`).toEqual([]);
  }
});
