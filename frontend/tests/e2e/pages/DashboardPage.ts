import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly metricsCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Dashboard' });
    this.metricsCards = page.locator('.grid.grid-cols-1.md\\:grid-cols-3 .rounded-xl');
  }

  async isVisible() {
    await this.heading.waitFor({ state: 'visible' });
  }
}
