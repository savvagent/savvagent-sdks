import { test, expect } from '../fixtures';

test.describe('User Context Handling', () => {
  test.beforeEach(async ({ page, featureDemo }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await featureDemo.waitForLoad();
  });

  test('should display initial user ID from default context', async ({ userSection }) => {
    const userId = await userSection.getCurrentUserId();
    // Default context should have a user ID set
    expect(userId).toBeTruthy();
    expect(userId).not.toBe('Not set');
  });

  test('should set random user ID when button clicked', async ({ userSection }) => {
    const initialUserId = await userSection.getCurrentUserId();
    await userSection.setRandomUserId();

    const newUserId = await userSection.getCurrentUserId();
    expect(newUserId).not.toBe(initialUserId);
    expect(newUserId).toMatch(/^user-\d+$/);
  });

  test('should clear user ID when clear button clicked', async ({ userSection }) => {
    // First set a user ID
    await userSection.setRandomUserId();
    await expect(userSection.userIdDisplay).not.toContainText('Not set');

    // Then clear it
    await userSection.clearUserId();
    await expect(userSection.userIdDisplay).toContainText('Not set');
  });

  test('should persist user ID across flag evaluations', async ({ userSection, page }) => {
    await userSection.setRandomUserId();
    const userId = await userSection.getCurrentUserId();

    // Wait a bit for any async updates
    await page.waitForTimeout(500);
    expect(await userSection.getCurrentUserId()).toBe(userId);
  });
});
