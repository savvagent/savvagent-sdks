/**
 * Savvagent settings shared by the server (root loader) and the browser.
 * The server and the browser must evaluate with the same context, so the
 * values the server renders match what the browser SDK computes after it.
 *
 * `language` is deliberately not here: the server takes it from the request's
 * Accept-Language, and the root loader sends that value to the browser, so a
 * language-targeted flag cannot flip after hydration.
 */
import type { DefaultFlagContext, FlagContext } from '@savvagent/react-router';

export const APPLICATION_ID = 'f8209ef5-a661-4f46-8b84-4c855a97d5ef';

/** Flags evaluated in the root loader and hydrated into the provider. */
export const FLAG_KEYS = ['new-feature', 'beta-feature', 'enterprise-one'];

/** Default flag values when evaluation fails. */
export const FLAG_DEFAULTS: Record<string, boolean> = {
  'new-feature': false,
  'beta-feature': false,
  'enterprise-one': false,
};

/**
 * The signed-in user in this demo. A real app takes this from its own
 * session on the server, never from a cookie or field the browser controls.
 */
export const DEMO_USER_ID = 'user-123';

const ENVIRONMENT = 'development';
const ORGANIZATION_ID = 'org-456';
const ATTRIBUTES = { plan: 'premium', country: 'US' };

/** Context for the browser SDK (camelCase, as @savvagent/react takes it). */
export const browserContext: DefaultFlagContext = {
  environment: ENVIRONMENT,
  userId: DEMO_USER_ID,
  organizationId: ORGANIZATION_ID,
  attributes: ATTRIBUTES,
};

/** The same context for server-side evaluation (FlagContext fields). */
export const serverContext: FlagContext = {
  environment: ENVIRONMENT,
  organization_id: ORGANIZATION_ID,
  attributes: ATTRIBUTES,
};
