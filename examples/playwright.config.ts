import { defineConfig, devices } from '@playwright/test';
import { APP_CONFIGS, BETA_ENV, MOCK_FLAGS_API_PORT, MOCK_FLAGS_API_URL, SERVER_FLAGS_ENV } from './e2e/utils/app-configs';
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
    const app = {
      command: `cd ${config.directory} && ${config.devCommand}`,
      url: `http://localhost:${config.port}`,
      timeout: config.startupTimeout,
      reuseExistingServer: !process.env.CI,
      env: config.serverFlags ? { ...BETA_ENV, ...SERVER_FLAGS_ENV } : BETA_ENV,
    };
    if (!config.serverFlags) return [app];
    // The app's server evaluates flags against the mock Flags API (see SERVER_FLAGS_ENV).
    // The mock starts only in a single-project run (PLAYWRIGHT_PROJECT set, as the
    // test:e2e:<app> scripts do), so e2e/specs/server-evaluation.spec.ts needs one.
    const mockFlagsApi = {
      command: 'node e2e/mock-flags-api.mjs',
      url: `${MOCK_FLAGS_API_URL}/health`,
      timeout: 10000,
      reuseExistingServer: !process.env.CI,
      env: {
        MOCK_FLAGS_API_PORT: String(MOCK_FLAGS_API_PORT),
        // The mock accepts only the key the app's server client is given.
        MOCK_FLAGS_API_KEY: SERVER_FLAGS_ENV.SAVVAGENT_FLAGS_API_KEY,
      },
    };
    return [mockFlagsApi, app];
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
