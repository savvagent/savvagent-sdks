import { Page, Locator } from '@playwright/test';

export class UserSectionPage {
  readonly page: Page;
  readonly section: Locator;
  readonly userIdDisplay: Locator;
  readonly setRandomUserIdButton: Locator;
  readonly clearUserIdButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.section = page.locator('.user-section');
    this.userIdDisplay = this.section.locator('code');
    this.setRandomUserIdButton = page.getByRole('button', { name: 'Set Random User ID' });
    this.clearUserIdButton = page.getByRole('button', { name: 'Clear User ID' });
  }

  async getCurrentUserId(): Promise<string> {
    return (await this.userIdDisplay.textContent()) ?? '';
  }

  async setRandomUserId(): Promise<void> {
    await this.setRandomUserIdButton.click();
  }

  async clearUserId(): Promise<void> {
    await this.clearUserIdButton.click();
  }

  async isUserIdSet(): Promise<boolean> {
    const userId = await this.getCurrentUserId();
    return userId !== 'Not set' && userId.length > 0;
  }
}
