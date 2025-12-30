import { test, expect } from '../fixtures';

test.describe('Flag Override Panel', () => {
  test.beforeEach(async ({ page, featureDemo }) => {
    await page.goto('/');
    await featureDemo.waitForLoad();
    // Clear localStorage to ensure clean state
    await page.evaluate(() => localStorage.clear());
  });

  test('should show trigger button with flag icon', async ({ overridePanel }) => {
    await expect(overridePanel.trigger).toBeVisible();
  });

  test('should open panel when trigger clicked', async ({ overridePanel }) => {
    await overridePanel.open();
    await expect(overridePanel.panel).toBeVisible();
    await expect(overridePanel.header).toContainText('Feature Flag Overrides');
  });

  test('should open panel with keyboard shortcut', async ({ overridePanel, appConfig }) => {
    // Skip for SSR frameworks that might not support this
    if (appConfig.framework === 'astro') {
      test.skip();
    }
    await overridePanel.openWithKeyboard();
    await expect(overridePanel.panel).toBeVisible();
  });

  test('should close panel when close button clicked', async ({ overridePanel }) => {
    await overridePanel.open();
    await overridePanel.close();
    await expect(overridePanel.panel).not.toBeVisible();
  });

  test('should close panel when clicking overlay', async ({ overridePanel }) => {
    await overridePanel.open();
    await overridePanel.closeByClickingOverlay();
    await expect(overridePanel.panel).not.toBeVisible();
  });

  test('should list all feature flags', async ({ overridePanel }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await expect(overridePanel.getFlagItem('new-feature')).toBeVisible();
    await expect(overridePanel.getFlagItem('beta-feature')).toBeVisible();
    await expect(overridePanel.getFlagItem('enterprise-one')).toBeVisible();
  });

  test('should set flag override to ON', async ({ overridePanel, featureDemo }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);

    // Check that override indicator appears
    expect(await overridePanel.isOverrideActive('new-feature')).toBe(true);

    // Close panel and verify UI updated
    await overridePanel.close();
    await expect(featureDemo.newFeatureCard.overrideBadge).toBeVisible();
    expect(await featureDemo.hasOverrideStyle(featureDemo.newFeatureCard)).toBe(true);
  });

  test('should set flag override to OFF', async ({ overridePanel, featureDemo }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', false);

    await overridePanel.close();
    const status = await featureDemo.getFeatureStatus(featureDemo.newFeatureCard);
    expect(status).toBe('Disabled');
  });

  test('should show override count in trigger badge', async ({ overridePanel }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.setOverride('beta-feature', false);
    await overridePanel.close();

    const badgeCount = await overridePanel.getTriggerBadgeCount();
    expect(badgeCount).toBe(2);
  });

  test('should clear single override', async ({ overridePanel }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.clearOverride('new-feature');

    expect(await overridePanel.isOverrideActive('new-feature')).toBe(false);
  });

  test('should clear all overrides', async ({ overridePanel }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.setOverride('beta-feature', false);
    await overridePanel.clearAllOverrides();

    const count = await overridePanel.getOverrideCount();
    expect(count).toBe(0);
  });

  test('should persist overrides across page reload', async ({ overridePanel, page, featureDemo }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.close();

    // Reload page
    await page.reload();
    await featureDemo.waitForLoad();

    // Override should persist
    await expect(featureDemo.newFeatureCard.overrideBadge).toBeVisible();
  });

  test('should show server value when overridden', async ({ overridePanel, featureDemo }) => {
    await overridePanel.open();
    await overridePanel.waitForFlagsLoaded();
    await overridePanel.setOverride('new-feature', true);
    await overridePanel.close();

    await expect(featureDemo.newFeatureCard.serverValue).toBeVisible();
    await expect(featureDemo.newFeatureCard.serverValue).toContainText('Server value:');
  });
});
