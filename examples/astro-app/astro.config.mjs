import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import savvagent from '@savvagent/astro';
import { savvagentConfig } from './src/savvagent.config.mjs';

export default defineConfig({
  // Flags are evaluated per request on the server, so render on demand.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321 },
  integrations: [savvagent({ config: savvagentConfig })],
});
