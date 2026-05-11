import { existsSync } from 'node:fs'
import { test, expect, chromium } from '@playwright/test'
import { LoginPage } from './pages/LoginPage'

const hasChromiumBrowser = existsSync(chromium.executablePath())

test.describe('Dashboard smoke', () => {
  test.skip(!hasChromiumBrowser, `Playwright Chromium is not installed at ${chromium.executablePath()}`)

  test('loads the protected dashboard and renders core KPI regions', async ({ page }) => {
    const email = process.env.E2E_EMAIL
    const password = process.env.E2E_PASSWORD

    if (!email || !password) {
      test.skip('No E2E credentials provided')
      return
    }

    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.login(email, password)

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText('Leads en BD')).toBeVisible()
    await expect(page.getByText('Ingresos Reales')).toBeVisible()
    await expect(page.getByText('Tendencia de Inversión')).toBeVisible()
  })
})
