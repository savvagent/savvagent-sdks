import { SAVVAGENT_FLAGS_API_KEY, SAVVAGENT_FLAGS_API_URL } from '$app/env/private';
import { initSvelteKitServer } from '@savvagent/sveltekit/server';

/**
 * The server-side client used by +page.server.ts. It reads private env
 * vars (declared in src/env.ts), so the key never reaches the browser. Without
 * SAVVAGENT_FLAGS_API_URL it uses the SDK's default Flags API; E2E points it
 * at a mock (examples/e2e/mock-flags-api.mjs).
 */
initSvelteKitServer({
  apiKey: SAVVAGENT_FLAGS_API_KEY || 'sdk_your_key_here',
  ...(SAVVAGENT_FLAGS_API_URL ? { baseUrl: SAVVAGENT_FLAGS_API_URL } : {}),
  applicationId: 'f8209ef5-a661-4f46-8b84-4c855a97d5ef',
  defaults: {
    'server-demo': false,
  },
  onError: (error) => {
    console.error('[App] Savvagent server error:', error);
  },
});
