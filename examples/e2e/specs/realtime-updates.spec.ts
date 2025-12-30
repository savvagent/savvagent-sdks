import { test, expect } from '../fixtures';

test.describe('Real-time Flag Updates', () => {
  test.beforeEach(async ({ page, featureDemo }) => {
    await page.goto('/');
    await featureDemo.waitForLoad();
  });

  test('should update UI without page refresh when override changes', async ({
    overridePanel,
    featureDemo,
    appConfig,
  }) => {
    // Skip for Astro SSR as it handles flags differently
    if (appConfig.framework === 'astro') {
      test.skip();
    }

    const initialStatus = await featureDemo.getFeatureStatus(featureDemo.newFeatureCard);

    // Set override to opposite of current value
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', initialStatus === 'Disabled');
    await overridePanel.close();

    // UI should update immediately without page refresh
    const newStatus = await featureDemo.getFeatureStatus(featureDemo.newFeatureCard);
    expect(newStatus).not.toBe(initialStatus);
  });

  test('should reflect override changes immediately in feature cards', async ({
    overridePanel,
    featureDemo,
    appConfig,
  }) => {
    if (appConfig.framework === 'astro') {
      test.skip();
    }

    // Enable new-feature via override
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.close();

    // Check that the alert appears (indicates flag is now enabled)
    await expect(featureDemo.newFeatureAlert).toBeVisible();

    // Now disable it
    await overridePanel.open();
    await overridePanel.setOverride('new-feature', false);
    await overridePanel.close();

    // Alert should disappear
    await expect(featureDemo.newFeatureAlert).not.toBeVisible();
  });

  test('should maintain flag state during panel interactions', async ({
    overridePanel,
    featureDemo,
    appConfig,
  }) => {
    if (appConfig.framework === 'astro') {
      test.skip();
    }

    // Get initial state
    const betaInitialStatus = await featureDemo.getFeatureStatus(featureDemo.betaFeatureCard);

    // Open and close panel without making changes
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.close();

    // Beta feature should still have same status
    const betaCurrentStatus = await featureDemo.getFeatureStatus(featureDemo.betaFeatureCard);
    expect(betaCurrentStatus).toBe(betaInitialStatus);
  });
});
