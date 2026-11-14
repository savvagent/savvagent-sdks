/**
 * Server-only Savvagent integration. React Router keeps `.server` modules
 * out of the browser bundle.
 */
import { createSavvagentServer } from '@savvagent/react-router';
import { APPLICATION_ID, DEMO_USER_ID, FLAG_DEFAULTS, serverContext } from './savvagent';

export const savvagent = createSavvagentServer(
  {
    apiKey: process.env.SAVVAGENT_SDK_KEY || '',
    baseUrl: process.env.SAVVAGENT_API_URL || 'https://api.savvagent.com/flags',
    applicationId: APPLICATION_ID,
    defaults: FLAG_DEFAULTS,
    onError: (error) => console.error('[server] Savvagent error:', error),
  },
  {
    defaultContext: serverContext,
    // Replace with your session lookup, e.g.
    // `(await getSession(request.headers.get('Cookie'))).get('userId')`.
    getUserId: () => DEMO_USER_ID,
  }
);

/** Settings the browser SDK needs. SDK keys (sdk_...) are safe to expose. */
export function browserConfig() {
  return {
    apiKey: process.env.VITE_SAVVAGENT_SDK_KEY || process.env.SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
    baseUrl:
      process.env.VITE_SAVVAGENT_API_URL || process.env.SAVVAGENT_API_URL || 'https://api.savvagent.com/flags',
  };
}
