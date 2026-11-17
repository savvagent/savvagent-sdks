import { createMiddleware, initMiddlewareClient } from '@savvagent/nextjs/middleware';
import { serverFlagConfig } from './lib/savvagent-server-config';

initMiddlewareClient(serverFlagConfig);

/**
 * Gives a first-time visitor an anonymous ID: the response sets the
 * `savvagent_anonymous_id` cookie, and the page rendered for this request
 * sees the same ID, so the visitor keeps one rollout bucket on the server
 * and in the browser.
 */
export default createMiddleware();

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
