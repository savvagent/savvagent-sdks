import { defineConfig } from 'astro/config';
import savvagent from '@savvagent/astro';

export default defineConfig({
  integrations: [
    savvagent({
      apiUrl: process.env.SAVVAGENT_API_URL || 'http://localhost:8080',
      sdkKey: process.env.SAVVAGENT_SDK_KEY || 'your-sdk-key',
      environment: 'development',
    }),
  ],
});
