/**
 * Server-side utilities for SvelteKit load functions and form actions
 */

import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import type { RequestEvent } from '@sveltejs/kit';
import {
  BoundedClient,
  boundedEvaluate,
  boundedWithFlag,
  createBoundedClient,
  resolveUserId,
} from './bounded';

export { DEFAULT_EVALUATION_TIMEOUT_MS } from './bounded';

/** The parts of a SvelteKit `RequestEvent` the helpers read. */
export type SavvagentEvent = Pick<RequestEvent, 'cookies' | 'request'> & Partial<Pick<RequestEvent, 'locals'>>;

/** Options for {@link initSvelteKitServer}. */
export interface SvelteKitServerOptions {
  /**
   * Resolve the authenticated user's ID for a request from your own auth,
   * for example from `event.locals` set in your `handle` hook. This is the
   * recommended source of `user_id`; {@link evaluateForEvent} calls it. If
   * it throws or rejects, the error goes to `onError` and the flag is
   * evaluated without a user.
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
   * Upper bound on one flag evaluation, in milliseconds (default: 1000).
   * When the Flags API is slow or down, the evaluation resolves with the
   * flag's default (`reason: 'error'`) instead of holding up the page.
   */
  evaluationTimeoutMs?: number;
}

let serverClient: BoundedClient | null = null;
let serverOptions: SvelteKitServerOptions = {};

function getBounded(): BoundedClient {
  if (!serverClient) {
    throw new Error(
      'SvelteKit server client not initialized. Call initSvelteKitServer() first.'
    );
  }
  return serverClient;
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
    serverClient = createBoundedClient(FlagClient, config, options.evaluationTimeoutMs);
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
  const trustCookie = options?.trustUserIdCookie ?? serverOptions.trustUserIdCookie ?? false;
  const context: FlagContext = {
    anonymous_id: event.cookies.get('savvagent_anonymous_id'),
    session_id: event.cookies.get('session_id'),
    language: event.request.headers.get('accept-language')?.split(',')[0] || undefined,
    ...overrides,
  };
  // An undefined `overrides.user_id` means "not given", not "no user".
  context.user_id = overrides?.user_id ?? ((trustCookie ? event.cookies.get('user_id') : undefined) || undefined);

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
  return (await boundedEvaluate(getBounded(), flagKey, context)).value;
}

/**
 * Evaluate a feature flag with detailed result.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<FlagEvaluationResult>
 */
export async function evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  return boundedEvaluate(getBounded(), flagKey, context);
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
  return boundedWithFlag(getBounded(), flagKey, callback, context);
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
  const eventContext = getEventContext(event, context);
  if (context?.user_id === undefined) {
    const { getUserId } = serverOptions;
    const userId = await resolveUserId(getUserId && (() => getUserId(event)), bounded.reportError);
    if (userId !== undefined) eventContext.user_id = userId;
  }
  return (await boundedEvaluate(bounded, flagKey, eventContext)).value;
}
