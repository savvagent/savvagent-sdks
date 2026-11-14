import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import savvagent from '@savvagent/astro';

export default defineConfig({
  // Flags are evaluated per request on the server, so render on demand.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321 },
  // The middleware imports this module at server runtime.
  integrations: [savvagent({ configModule: './src/savvagent.config.mjs' })],
});
