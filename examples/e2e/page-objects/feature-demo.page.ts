import { Page, Locator } from '@playwright/test';

export interface FeatureCard {
  name: string;
  locator: Locator;
  status: Locator;
  overrideBadge: Locator;
  serverValue: Locator;
  variation: Locator;
  config: Locator;
}

export class FeatureDemoPage {
  readonly page: Page;
  readonly container: Locator;
  readonly title: Locator;
  readonly subtitle: Locator;
  readonly loadingIndicator: Locator;
  readonly newFeatureCard: FeatureCard;
  readonly betaFeatureCard: FeatureCard;
  readonly enterpriseOneCard: FeatureCard;
  readonly newFeatureAlert: Locator;
  readonly testErrorButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.container = page.locator('.container');
    this.title = page.locator('h1');
    this.subtitle = page.locator('.subtitle');
    this.loadingIndicator = page.locator('.loading');

    this.newFeatureCard = this.createFeatureCard('New Feature');
    this.betaFeatureCard = this.createFeatureCard('Beta Feature');
    this.enterpriseOneCard = this.createFeatureCard('Enterprise One');

    this.newFeatureAlert = page.locator('.alert-success');
    this.testErrorButton = page.getByRole('button', { name: 'Test Error Tracking' });
  }

  private createFeatureCard(name: string): FeatureCard {
    const card = this.page.locator('.feature-card').filter({ hasText: name });
    return {
      name,
      locator: card,
      status: card.locator('.status'),
      overrideBadge: card.locator('.override-badge-inline'),
      serverValue: card.locator('.server-value'),
      variation: card.locator('.variation'),
      config: card.locator('.config'),
    };
  }

  async waitForLoad(): Promise<void> {
    await this.loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 });
  }

  async isLoaded(): Promise<boolean> {
    return !(await this.loadingIndicator.isVisible());
  }

  async getFeatureStatus(card: FeatureCard): Promise<'Enabled' | 'Disabled'> {
    const text = await card.status.textContent();
    return text?.includes('Enabled') ? 'Enabled' : 'Disabled';
  }

  async isFeatureEnabled(card: FeatureCard): Promise<boolean> {
    const classes = await card.status.getAttribute('class');
    return classes?.includes('enabled') ?? false;
  }

  async isOverridden(card: FeatureCard): Promise<boolean> {
    return await card.overrideBadge.isVisible();
  }

  async hasOverrideStyle(card: FeatureCard): Promise<boolean> {
    const classes = await card.locator.getAttribute('class');
    return classes?.includes('feature-card-overridden') ?? false;
  }

  getAllFeatureCards(): FeatureCard[] {
    return [this.newFeatureCard, this.betaFeatureCard, this.enterpriseOneCard];
  }
}
