import { test as base } from '@playwright/test';
import { FeatureDemoPage } from '../page-objects/feature-demo.page';
import { FlagOverridePanelPage } from '../page-objects/flag-override-panel.page';
import { UserSectionPage } from '../page-objects/user-section.page';
import { APP_CONFIGS, AppConfig } from '../utils/app-configs';

interface SavvagentFixtures {
  featureDemo: FeatureDemoPage;
  overridePanel: FlagOverridePanelPage;
  userSection: UserSectionPage;
  appConfig: AppConfig;
}

export const test = base.extend<SavvagentFixtures>({
  appConfig: async ({}, use, testInfo) => {
    const projectName = testInfo.project.name;
    const config = APP_CONFIGS[projectName];
    if (!config) {
      throw new Error(`No config found for project: ${projectName}`);
    }
    await use(config);
  },

  featureDemo: async ({ page }, use) => {
    const featureDemo = new FeatureDemoPage(page);
    await use(featureDemo);
  },

  overridePanel: async ({ page }, use) => {
    const overridePanel = new FlagOverridePanelPage(page);
    await use(overridePanel);
  },

  userSection: async ({ page }, use) => {
    const userSection = new UserSectionPage(page);
    await use(userSection);
  },
});

export { expect } from '@playwright/test';
