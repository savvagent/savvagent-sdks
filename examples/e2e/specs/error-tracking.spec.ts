import { test, expect } from '../fixtures';

test.describe('Error Tracking Integration', () => {
  test.beforeEach(async ({ page, featureDemo, overridePanel, appConfig }) => {
    // Skip for Astro as it's SSR-only
    if (appConfig.framework === 'astro') {
      test.skip();
    }

    await page.goto('/');
    await featureDemo.waitForLoad();

    // Ensure new-feature is enabled so we can see the error tracking button
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.close();
  });

  test('should display Test Error Tracking button when feature enabled', async ({ featureDemo }) => {
    await expect(featureDemo.testErrorButton).toBeVisible();
  });

  test('should handle error tracking button click', async ({ page, featureDemo }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await featureDemo.testErrorButton.click();

    // Wait for error to be logged
    await page.waitForTimeout(500);

    // Should log the error to console
    expect(consoleErrors.some((e) => e.includes('Action failed') || e.includes('Example error'))).toBe(true);
  });

  test('should not throw uncaught exception when tracking error', async ({ page, featureDemo }) => {
    let uncaughtException = false;
    page.on('pageerror', () => {
      uncaughtException = true;
    });

    await featureDemo.testErrorButton.click();
    await page.waitForTimeout(500);

    expect(uncaughtException).toBe(false);
  });

  test('should continue functioning after error is tracked', async ({ page, featureDemo, overridePanel }) => {
    // Click error button
    await featureDemo.testErrorButton.click();
    await page.waitForTimeout(500);

    // App should still be functional - can interact with override panel
    await overridePanel.open();
    await expect(overridePanel.panel).toBeVisible();
    await overridePanel.close();

    // Can still see feature cards
    await expect(featureDemo.newFeatureCard.locator).toBeVisible();
  });
});
