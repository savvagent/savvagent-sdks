/**
 * Server-side utilities for SvelteKit load functions and form actions
 */

import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import type { RequestEvent } from '@sveltejs/kit';
import {
  ANONYMOUS_ID_COOKIE,
  RequestScope,
  RequestScopeOptions,
  ServerClient,
  anonymousIdCookieOptions,
  buildRequestContext,
  createRequestScope,
  createServerClient,
  defaultReportError,
  evaluateBounded,
  fallbackResult,
  isSecureUrl,
  newAnonymousId,
} from '@savvagent/sdk/server';

export { DEFAULT_EVALUATION_TIMEOUT_MS } from '@savvagent/sdk/server';

/** The parts of a SvelteKit `RequestEvent` the helpers read. */
export type SavvagentEvent = Pick<RequestEvent, 'cookies' | 'request'> & Partial<Pick<RequestEvent, 'locals'>>;

/** Options for {@link initSvelteKitServer}. */
export interface SvelteKitServerOptions {
  /**
   * Resolve the authenticated user's ID for a request from your own auth,
   * for example from `event.locals` set in your `handle` hook. This is the
   * recommended source of `user_id`; {@link evaluateForEvent} calls it. It
   * is bounded by `evaluationTimeoutMs`; if it throws, rejects or times out,
   * the failure goes to `onError` and the flag is evaluated without a user
   * (also without a trusted `user_id` cookie).
   */
  getUserId?: (event: SavvagentEvent) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Read `user_id` from the `user_id` cookie. Off by default: the browser
   * sets that cookie, so any visitor can claim another user's ID and receive
   * that user's targeted flags. Enable it only for demos, or when nothing a
   * flag gates is sensitive.
   */
  trustUserIdCookie?: boolean;
  /**
   * Upper bound on one flag evaluation, and on `getUserId`, in milliseconds
   * (default: 1000).
   * When the Flags API is slow or down, the evaluation resolves with the
   * flag's default (`reason: 'error'`) instead of holding up the page.
   */
  evaluationTimeoutMs?: number;
}

let serverClient: ServerClient<FlagClient> | null = null;
let serverOptions: SvelteKitServerOptions = {};

function getBounded(): ServerClient<FlagClient> {
  if (!serverClient) {
    throw new Error(
      'SvelteKit server client not initialized. Call initSvelteKitServer() first.'
    );
  }
  return serverClient;
}

/** How evaluations on the server client are bounded, and what a failed one returns. */
function boundOf(bounded: ServerClient<FlagClient>) {
  return {
    timeoutMs: bounded.timeoutMs,
    reportError: bounded.reportError,
    // A failed evaluation: the flag's default, `reason: 'error'`, with a timestamp.
    fallback: (flagKey: string): FlagEvaluationResult => ({
      ...fallbackResult(flagKey, bounded.config.defaults),
      metadata: { timestamp: Date.now() },
    }),
  };
}

/** The request scope of an event: its context, its user and bounded evaluation. */
function eventScope(bounded: ServerClient<FlagClient>, options: Omit<RequestScopeOptions, 'client'>): RequestScope {
  const { timeoutMs, reportError, fallback } = boundOf(bounded);
  return createRequestScope({ client: bounded.client, evaluationTimeoutMs: timeoutMs, reportError, fallback, ...options });
}

/** Anonymous IDs assigned to requests without the cookie, keyed by the request's `cookies`. */
const assignedIds = new WeakMap<object, string>();

/**
 * The anonymous ID of a visitor who has no `savvagent_anonymous_id` cookie:
 * one new ID per request, stored in the cookie (not HttpOnly, so the browser
 * SDK buckets the visitor the same way; `Path=/`, `SameSite=Lax`, one year,
 * `Secure` on https).
 */
function assignAnonymousId(event: Pick<RequestEvent, 'cookies' | 'request'>): string {
  let anonymousId = assignedIds.get(event.cookies);
  if (anonymousId) return anonymousId;
  anonymousId = newAnonymousId();
  assignedIds.set(event.cookies, anonymousId);
  // A hand-built event may have no `set`; the ID then lasts for this request only.
  if (typeof event.cookies.set === 'function') {
    try {
      event.cookies.set(ANONYMOUS_ID_COOKIE, anonymousId, anonymousIdCookieOptions(isSecureUrl(event.request.url)));
    } catch (error) {
      // SvelteKit refuses cookies once the response has started (streamed loads).
      (serverClient?.reportError ?? defaultReportError)(
        Object.assign(new Error('Could not set the savvagent_anonymous_id cookie'), { cause: error })
      );
    }
  }
  return anonymousId;
}

/**
 * Initialize the server-side Savvagent client.
 * Call this once in hooks.server.ts or root +layout.server.ts.
 *
 * The client makes one attempt per evaluation (`retryAttempts: 1`), opens
 * no realtime connection and does not detect a language from the server's
 * locale, unless `config` says otherwise. Each evaluation through this
 * module is bounded by `options.evaluationTimeoutMs`, and `onError` reports
 * the same message at most once a minute, so an unreachable Flags API cannot
 * stall every page.
 *
 * @param config - Client configuration
 * @param options - User identity and timeout options
 * @returns The FlagClient instance
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { initSvelteKitServer } from '@savvagent/sveltekit/server';
 *
 * initSvelteKitServer(
 *   {
 *     apiKey: process.env.SAVVAGENT_API_KEY!,
 *     applicationId: process.env.SAVVAGENT_APP_ID,
 *   },
 *   { getUserId: (event) => event.locals?.user?.id }
 * );
 * ```
 */
export function initSvelteKitServer(
  config: FlagClientConfig,
  options: SvelteKitServerOptions = {}
): FlagClient {
  if (!serverClient) {
    serverClient = createServerClient(FlagClient, config, { evaluationTimeoutMs: options.evaluationTimeoutMs });
    serverOptions = options;
  }
  return serverClient.client;
}

/**
 * Get the server-side Savvagent client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getServerClient(): FlagClient {
  return getBounded().client;
}

/**
 * Extract context from SvelteKit RequestEvent: `anonymous_id` and
 * `session_id` from cookies, and `language` from `Accept-Language`.
 *
 * A visitor without a `savvagent_anonymous_id` cookie gets a new anonymous
 * ID, the same for the whole request, and the cookie is set on the
 * response, so each visitor keeps one rollout bucket on the server and in
 * the browser.
 *
 * `user_id` is read from the `user_id` cookie only when `trustUserIdCookie`
 * is set (here or in `initSvelteKitServer`), because the browser controls
 * that cookie. Pass the authenticated user as `overrides.user_id`, or use
 * {@link evaluateForEvent} with the `getUserId` option.
 *
 * @param event - SvelteKit RequestEvent
 * @param overrides - Additional context properties
 * @param options - `trustUserIdCookie` for this call
 * @returns FlagContext
 *
 * @example
 * ```ts
 * export async function load({ cookies, request }) {
 *   const context = getEventContext({ cookies, request });
 *   const enabled = await isEnabled('my-feature', context);
 *   return { enabled };
 * }
 * ```
 */
export function getEventContext(
  event: Pick<RequestEvent, 'cookies' | 'request'>,
  overrides?: FlagContext,
  options?: { trustUserIdCookie?: boolean }
): FlagContext {
  const context = buildRequestContext(
    {
      cookies: (name) => event.cookies.get(name),
      acceptLanguage: event.request.headers.get('accept-language'),
      trustUserIdCookie: options?.trustUserIdCookie ?? serverOptions.trustUserIdCookie ?? false,
    },
    overrides
  );
  if (!context.anonymous_id) context.anonymous_id = assignAnonymousId(event);
  return context;
}

/**
 * Check if a feature flag is enabled in a SvelteKit load function.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<boolean>
 *
 * @example
 * ```ts
 * // +page.server.ts
 * import { isEnabled } from '@savvagent/sveltekit/server';
 *
 * export async function load({ locals }) {
 *   const enabled = await isEnabled('new-feature', {
 *     user_id: locals.user?.id,
 *   });
 *
 *   return { enabled };
 * }
 * ```
 */
export async function isEnabled(
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  return (await evaluate(flagKey, context)).value;
}

/**
 * Evaluate a feature flag with detailed result.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<FlagEvaluationResult>
 */
export async function evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  const bounded = getBounded();
  return evaluateBounded(bounded.client, flagKey, context, boundOf(bounded));
}

/**
 * Execute code conditionally based on flag value.
 *
 * @param flagKey - The flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param context - Optional context for targeting
 * @returns Promise with callback result or null
 */
export async function withFlag<T>(
  flagKey: string,
  callback: () => T | Promise<T>,
  context?: FlagContext
): Promise<T | null> {
  const bounded = getBounded();
  if (!(await evaluateBounded(bounded.client, flagKey, context, boundOf(bounded))).value) return null;
  try {
    return await callback();
  } catch (error) {
    // Tracked against the flag, then re-thrown.
    bounded.client.trackError(flagKey, error as Error, context);
    throw error;
  }
}

/**
 * Track an error with flag context.
 *
 * @param flagKey - The flag key associated with the error
 * @param error - The error that occurred
 * @param context - Optional context
 */
export function trackError(
  flagKey: string,
  error: Error,
  context?: FlagContext
): void {
  const client = getServerClient();
  client.trackError(flagKey, error, context);
}

/**
 * Helper to evaluate flags in load functions with automatic event context.
 *
 * `user_id` comes from, in order: `context.user_id`, the `getUserId`
 * option, or the `user_id` cookie when `trustUserIdCookie` is set.
 * `anonymous_id` is the visitor's (see {@link getEventContext}).
 *
 * @param event - SvelteKit RequestEvent
 * @param flagKey - The flag key to evaluate
 * @param context - Optional additional context
 * @returns Promise<boolean>
 *
 * @example
 * ```ts
 * import { evaluateForEvent } from '@savvagent/sveltekit/server';
 *
 * export async function load(event) {
 *   const showBeta = await evaluateForEvent(event, 'beta-ui');
 *   return { showBeta };
 * }
 * ```
 */
export async function evaluateForEvent(
  event: SavvagentEvent,
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const bounded = getBounded();
  const { getUserId } = serverOptions;
  return eventScope(bounded, {
    context: getEventContext(event),
    userId: context?.user_id,
    getUserId: getUserId && (() => getUserId(event)),
  }).isEnabled(flagKey, context);
}
