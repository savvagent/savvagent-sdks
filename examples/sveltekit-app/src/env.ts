import { defineEnvVars } from '@sveltejs/kit/env';

/** Server-only settings of the Savvagent server client (see hooks.server.ts). */
export const variables = defineEnvVars({
  SAVVAGENT_FLAGS_API_KEY: {
    description: 'Flags API key for server-side evaluation. Never sent to the browser.',
    schema: (value) => value || undefined,
  },
  SAVVAGENT_FLAGS_API_URL: {
    description: "Flags API base URL for server-side evaluation (default: the SDK's).",
    schema: (value) => value || undefined,
  },
});
