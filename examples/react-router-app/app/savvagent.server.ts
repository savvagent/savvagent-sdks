/**
 * Server-only Savvagent integration. React Router keeps `.server` modules
 * out of the browser bundle.
 */
import { createSavvagentServer } from '@savvagent/react-router';
import { APPLICATION_ID, DEMO_USER_ID, FLAG_DEFAULTS, serverContext } from './savvagent';

export const savvagent = createSavvagentServer(
  {
    apiKey: process.env.SAVVAGENT_FLAGS_API_KEY || '',
    baseUrl: process.env.SAVVAGENT_FLAGS_API_URL || 'https://api.savvagent.com/flags',
    applicationId: APPLICATION_ID,
    defaults: FLAG_DEFAULTS,
    onError: (error) => console.error('[server] Savvagent error:', error),
  },
  {
    defaultContext: serverContext,
    // Replace with your session lookup, e.g.
    // `(await getSession(request.headers.get('Cookie'))).get('userId')`.
    getUserId: () => DEMO_USER_ID,
    // The library default is 1000 ms. The example raises it only to absorb
    // dev-server cold starts (first request compiles modules and opens the
    // connection to the Flags API) in the E2E suite.
    evaluationTimeoutMs: 5000,
  }
);

/**
 * Settings the browser SDK needs, sent to the page in loader data. The key
 * must be a public client SDK key (`sdk_...`): it is visible to every
 * visitor. It is read from its own variable, never from the server's key.
 */
export function browserConfig() {
  return {
    apiKey: process.env.VITE_SAVVAGENT_FLAGS_API_KEY || 'sdk_your_key_here',
    // Never fall back to the server's SAVVAGENT_FLAGS_API_URL: it may be an
    // internal address, and this value is rendered for every visitor.
    baseUrl: process.env.VITE_SAVVAGENT_FLAGS_API_URL || 'https://api.savvagent.com/flags',
  };
}
