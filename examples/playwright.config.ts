import { defineConfig, devices } from '@playwright/test';
import { APP_CONFIGS, BETA_ENV } from './e2e/utils/app-configs';
import * as path from 'path';

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env.test') });

// Determine which project to run (from command line --project flag or env var)
// When running a single project, we only start that app's dev server
const targetProject = process.env.PLAYWRIGHT_PROJECT;

// Generate projects for each app
const projects = Object.entries(APP_CONFIGS).map(([appId, config]) => ({
  name: appId,
  use: {
    baseURL: `http://localhost:${config.port}`,
    ...devices['Desktop Chrome'],
  },
  testMatch: 'e2e/specs/**/*.spec.ts',
}));

// Configure web server(s) based on target project
// If running a specific project, only start that server
// If running all projects, require servers to be pre-started (reuseExistingServer: true)
function getWebServerConfig() {
  if (targetProject && APP_CONFIGS[targetProject]) {
    const config = APP_CONFIGS[targetProject];
    return [
      {
        command: `cd ${config.directory} && ${config.devCommand}`,
        url: `http://localhost:${config.port}`,
        timeout: config.startupTimeout,
        reuseExistingServer: !process.env.CI,
        env: BETA_ENV,
      },
    ];
  }

  // When running all projects, don't auto-start servers (they'd conflict)
  // User must start the specific app's dev server manually
  return undefined;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ...(process.env.CI ? [['github'] as const] : []),
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects,
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  webServer: getWebServerConfig(),
});
