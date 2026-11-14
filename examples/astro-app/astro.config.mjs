import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import savvagent from '@savvagent/astro';

export default defineConfig({
  // Flags are evaluated per request on the server, so render on demand.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321 },
  integrations: [
    savvagent({
      // The middleware imports this module at server runtime.
      configModule: './src/savvagent.config.mjs',
      // Demo only: the user switcher sets a `user_id` cookie, so this example
      // trusts it. Any visitor can set that cookie to any ID; a real app must
      // export `getUserId` from the config module and read its own session.
      trustUserIdCookie: true,
    }),
  ],
});
