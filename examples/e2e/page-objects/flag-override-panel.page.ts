import { Page, Locator } from '@playwright/test';

export class FlagOverridePanelPage {
  readonly page: Page;
  readonly trigger: Locator;
  readonly panel: Locator;
  readonly overlay: Locator;
  readonly header: Locator;
  readonly refreshButton: Locator;
  readonly clearAllButton: Locator;
  readonly closeButton: Locator;
  readonly flagList: Locator;
  readonly footer: Locator;
  readonly overrideCount: Locator;

  constructor(page: Page) {
    this.page = page;
    this.trigger = page.locator('.flag-panel-trigger');
    this.panel = page.locator('.flag-panel');
    this.overlay = page.locator('.flag-panel-overlay');
    this.header = page.locator('.flag-panel-header');
    this.refreshButton = page.locator('.flag-panel-btn-secondary').filter({ hasText: 'Refresh' });
    this.clearAllButton = page.locator('.flag-panel-btn-secondary').filter({ hasText: 'Clear All' });
    this.closeButton = page.locator('.flag-panel-btn-close');
    this.flagList = page.locator('.flag-list');
    this.footer = page.locator('.flag-panel-footer');
    this.overrideCount = page.locator('.override-count');
  }

  async open(): Promise<void> {
    await this.trigger.click();
    await this.panel.waitFor({ state: 'visible' });
  }

  async openWithKeyboard(): Promise<void> {
    await this.page.keyboard.press('Control+Shift+F');
    await this.panel.waitFor({ state: 'visible' });
  }

  async close(): Promise<void> {
    await this.closeButton.click();
    await this.panel.waitFor({ state: 'hidden' });
  }

  async closeByClickingOverlay(): Promise<void> {
    await this.overlay.click({ position: { x: 10, y: 10 } });
    await this.panel.waitFor({ state: 'hidden' });
  }

  getFlagItem(flagKey: string): Locator {
    return this.flagList.locator('.flag-item').filter({ hasText: flagKey });
  }

  async setOverride(flagKey: string, value: boolean): Promise<void> {
    const flagItem = this.getFlagItem(flagKey);
    const buttonText = value ? 'ON' : 'OFF';
    await flagItem.locator('.flag-toggle-btn').filter({ hasText: buttonText }).click();
  }

  async clearOverride(flagKey: string): Promise<void> {
    const flagItem = this.getFlagItem(flagKey);
    await flagItem.locator('.flag-clear-btn').click();
  }

  async clearAllOverrides(): Promise<void> {
    await this.clearAllButton.click();
  }

  async getOverrideCount(): Promise<number> {
    const text = await this.overrideCount.textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async isOverrideActive(flagKey: string): Promise<boolean> {
    const flagItem = this.getFlagItem(flagKey);
    return await flagItem.locator('.override-indicator').isVisible();
  }

  async getTriggerBadgeCount(): Promise<number | null> {
    const badge = this.trigger.locator('.override-badge');
    if (await badge.isVisible()) {
      const text = await badge.textContent();
      return text ? parseInt(text, 10) : null;
    }
    return null;
  }

  async waitForFlagsLoaded(): Promise<void> {
    await this.flagList.locator('.flag-item').first().waitFor({ state: 'visible', timeout: 10000 });
  }
}
