import { defineConfig } from 'astro/config';
import savvagent from '@savvagent/astro';

export default defineConfig({
  integrations: [
    savvagent({
      config: {
        apiKey: process.env.SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
        baseUrl: process.env.SAVVAGENT_API_URL || 'https://api.savvagent.com/flags',
      },
    }),
  ],
});
