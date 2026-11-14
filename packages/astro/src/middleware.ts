/**
 * @savvagent/astro/middleware - registered by the integration via `addMiddleware`.
 *
 * Provides `Astro.locals.savvagent` on every request, using the config passed
 * to the integration in astro.config (served by a virtual module).
 */

import config from 'virtual:@savvagent/astro/config';
import { createSavvagentMiddleware } from './index';

export const onRequest = createSavvagentMiddleware(config);
