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

  if (againstProduction && path === '/financials') {
    return /^(Finanzas verificadas|Auditoría operativa Doctoralia)$/i;
  }

  return new RegExp(`^${escapeRegExp(heading)}$`, 'i');
}

function isSupabaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

test('authenticated Control Centre routes load without runtime or server errors', async ({ page }) => {
  test.setTimeout(120_000);

  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD are required for the production Control Centre smoke test.');
  }

  const pageErrors: string[] = [];
  const networkFailures: string[] = [];
  const httpErrors: string[] = [];
  const policyErrors: string[] = [];
  const canonicalCrmErrors: string[] = [];

  const resetRuntimeEvidence = () => {
    pageErrors.length = 0;
    networkFailures.length = 0;
    httpErrors.length = 0;
    policyErrors.length = 0;
    canonicalCrmErrors.length = 0;
  };

  const assertRuntimeHealthy = async (label: string) => {
    await page.waitForTimeout(1_250);
    await expect(page.getByText(/error inesperado/i)).toHaveCount(0);
    await expect(page.getByText(/ha ocurrido un error cargando esta sección/i)).toHaveCount(0);

    expect(pageErrors, `${label} emitted page runtime errors`).toEqual([]);
    expect(networkFailures, `${label} emitted non-aborted Supabase request failures`).toEqual([]);
    expect(httpErrors, `${label} received Supabase HTTP 4xx/5xx responses`).toEqual([]);
    expect(policyErrors, `${label} emitted CORS/CSP policy errors`).toEqual([]);
    expect(canonicalCrmErrors, `${label} emitted canonical CRM failures`).toEqual([]);
    resetRuntimeEvidence();
  };

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }

    const text = msg.text();
    if (/cors|content security policy|blocked by client/i.test(text)) {
      policyErrors.push(text);
    }
    if (/canonical crm load failed/i.test(text)) {
      canonicalCrmErrors.push(text);
    }
  });

  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText || 'unknown';
    console.log(`[REQUEST FAILED] ${request.url()} - ${reason}`);

    if (!isSupabaseUrl(request.url())) return;
    // Chromium reports requests cancelled by route/lifecycle transitions as
    // ERR_ABORTED. Supabase backend logs are checked separately and these are
    // not transport failures. Every other failed Supabase request is fatal.
    if (!reason.includes('ERR_ABORTED')) {
      networkFailures.push(`${reason} ${request.url()}`);
    }
  });

  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[HTTP ${response.status()}] ${response.url()}`);
    }
    if (isSupabaseUrl(response.url()) && response.status() >= 400) {
      httpErrors.push(`${response.status()} ${response.url()}`);
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
  await assertRuntimeHealthy('/dashboard after login');

  for (const route of CONTROL_CENTRE_ROUTES) {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}/?$`));
    await expect(page.getByRole('navigation', { name: /navegación principal/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: new RegExp(`^${escapeRegExp(route.label)}$`, 'i') })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: expectedHeading(route.path, route.heading) }).first()).toBeVisible({ timeout: 15_000 });

    if (route.path === '/dashboard') {
      await expect(page.getByTestId('control-centre-overview')).toBeVisible({ timeout: 15_000 });
    }

    await assertRuntimeHealthy(route.path);
  }
});
