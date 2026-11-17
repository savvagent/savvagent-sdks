import { evaluate, initServerClient } from '@savvagent/nextjs/server';
import { serverFlagConfig } from '../../lib/savvagent-server-config';

// First call wins; module scope keeps it to one client per server process.
initServerClient(serverFlagConfig);

interface Received {
  anonymous_id?: string | null;
  user_id?: string | null;
}

/**
 * Server Component: evaluates `server-demo` on the server through
 * @savvagent/nextjs/server, so the result is in the initial HTML.
 *
 * The context comes from the request: the anonymous ID from the cookie the
 * middleware set, and no `user_id`, because the `user_id` cookie is not
 * trusted by default. "Evaluated with" shows the identifiers the Flags API
 * received, which the E2E mock echoes back in the flag's configuration.
 */
export async function ServerFlag() {
  const result = await evaluate('server-demo');
  const received = (result.metadata?.configuration as { received?: Received } | undefined)?.received;

  return (
    <section className="server-flag" data-testid="server-flag">
      <h2>Server-Side Evaluation</h2>
      <p>
        <code>server-demo</code>:{' '}
        <span data-testid="server-flag-value">{result.value ? 'enabled' : 'disabled'}</span>
        {' '}(reason: <span data-testid="server-flag-reason">{result.reason}</span>)
      </p>
      <p>
        Evaluated with anonymous_id{' '}
        <span data-testid="server-anonymous-id">{received?.anonymous_id ?? '(unknown)'}</span>
        {' '}and user_id <span data-testid="server-user-id">{received ? received.user_id ?? '(none)' : '(unknown)'}</span>
      </p>
    </section>
  );
}
