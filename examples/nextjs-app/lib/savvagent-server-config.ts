import type { FlagClientConfig } from '@savvagent/sdk';

/**
 * Configuration of the server-side clients (Server Components and the
 * middleware). Server code reads non-public env vars, so the key never
 * reaches the browser. Without SAVVAGENT_FLAGS_API_URL it uses the SDK's
 * default Flags API; E2E points it at a mock (examples/e2e/mock-flags-api.mjs).
 */
export const serverFlagConfig: FlagClientConfig = {
  apiKey: process.env.SAVVAGENT_FLAGS_API_KEY || 'sdk_your_key_here',
  ...(process.env.SAVVAGENT_FLAGS_API_URL ? { baseUrl: process.env.SAVVAGENT_FLAGS_API_URL } : {}),
  applicationId: 'f8209ef5-a661-4f46-8b84-4c855a97d5ef',
  defaults: {
    'server-demo': false,
  },
  onError: (error) => {
    console.error('[App] Savvagent server error:', error);
  },
};
