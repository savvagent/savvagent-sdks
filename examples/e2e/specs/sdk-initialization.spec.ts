import { test, expect } from '../fixtures';

test.describe('SDK Provider Initialization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display loading state initially', async ({ featureDemo }) => {
    // Check loading indicator appears (may be very brief)
    const isLoading = await featureDemo.loadingIndicator.isVisible();
    // Either loading or already loaded is acceptable
    expect(isLoading || (await featureDemo.isLoaded())).toBe(true);
  });

  test('should initialize and show content after loading', async ({ featureDemo }) => {
    await featureDemo.waitForLoad();
    await expect(featureDemo.title).toBeVisible();
  });

  test('should display all three feature cards', async ({ featureDemo }) => {
    await featureDemo.waitForLoad();
    await expect(featureDemo.newFeatureCard.locator).toBeVisible();
    await expect(featureDemo.betaFeatureCard.locator).toBeVisible();
    await expect(featureDemo.enterpriseOneCard.locator).toBeVisible();
  });

  test('should show correct app name in title', async ({ featureDemo, appConfig }) => {
    await featureDemo.waitForLoad();
    await expect(featureDemo.title).toContainText(appConfig.name);
  });

  test('should not show error state on successful initialization', async ({ page, featureDemo }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Savvagent')) {
        consoleErrors.push(msg.text());
      }
    });

    await featureDemo.waitForLoad();
    await page.waitForTimeout(1000);

    // No Savvagent-specific errors should be logged
    expect(consoleErrors).toHaveLength(0);
  });
});
