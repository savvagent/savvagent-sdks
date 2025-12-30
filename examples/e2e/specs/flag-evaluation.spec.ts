import { test, expect } from '../fixtures';

test.describe('Flag Evaluation and UI Rendering', () => {
  test.beforeEach(async ({ page, featureDemo }) => {
    await page.goto('/');
    await featureDemo.waitForLoad();
  });

  test('should display flag status for each feature', async ({ featureDemo }) => {
    for (const card of featureDemo.getAllFeatureCards()) {
      const status = await featureDemo.getFeatureStatus(card);
      expect(['Enabled', 'Disabled']).toContain(status);
    }
  });

  test('should apply correct CSS class based on flag status', async ({ featureDemo }) => {
    const newFeatureEnabled = await featureDemo.isFeatureEnabled(featureDemo.newFeatureCard);
    if (newFeatureEnabled) {
      await expect(featureDemo.newFeatureCard.status).toHaveClass(/enabled/);
    } else {
      await expect(featureDemo.newFeatureCard.status).toHaveClass(/disabled/);
    }
  });

  test('should show success alert when new-feature is enabled', async ({ featureDemo }) => {
    const isEnabled = await featureDemo.isFeatureEnabled(featureDemo.newFeatureCard);
    if (isEnabled) {
      await expect(featureDemo.newFeatureAlert).toBeVisible();
      await expect(featureDemo.newFeatureAlert).toContainText('New Feature Enabled');
    } else {
      await expect(featureDemo.newFeatureAlert).not.toBeVisible();
    }
  });

  test('should display variation metadata when available', async ({ featureDemo }) => {
    const variation = featureDemo.newFeatureCard.variation;
    if (await variation.isVisible()) {
      await expect(variation).toContainText('Variation:');
    }
  });

  test('should display configuration metadata when available', async ({ featureDemo }) => {
    const config = featureDemo.newFeatureCard.config;
    if (await config.isVisible()) {
      await expect(config).toContainText('Config:');
      await expect(config.locator('code')).toBeVisible();
    }
  });
});
