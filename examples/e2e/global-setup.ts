import { FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

async function globalSetup(config: FullConfig) {
  // Load environment variables from .env.test
  const envPath = path.join(__dirname, '..', '.env.test');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }

  console.log('Playwright E2E Tests - Global Setup');
  console.log('Running against Savvagent beta environment');
}

export default globalSetup;
