import { evaluate, getEventContext } from '@savvagent/sveltekit/server';
import type { PageServerLoad } from './$types';

interface Received {
  anonymous_id?: string | null;
  user_id?: string | null;
}

/**
 * Evaluates `server-demo` on the server through @savvagent/sveltekit, so
 * the result is in the initial HTML.
 *
 * getEventContext reads the request: the anonymous ID from the
 * `savvagent_anonymous_id` cookie (a first-time visitor gets a new one, set
 * on this response) and no `user_id`, because the `user_id` cookie is not
 * trusted by default. `received` is what the Flags API got, which the E2E
 * mock echoes back in the flag's configuration.
 */
export const load: PageServerLoad = async (event) => {
  const context = getEventContext(event);
  const result = await evaluate('server-demo', context);
  const received = (result.metadata?.configuration as { received?: Received } | undefined)?.received;

  return {
    serverFlag: {
      value: result.value,
      reason: result.reason,
      received: received ? { anonymous_id: received.anonymous_id ?? null, user_id: received.user_id ?? null } : null,
    },
  };
};
