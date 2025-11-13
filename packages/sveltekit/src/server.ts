/**
 * Server-side utilities for SvelteKit load functions and form actions
 */

import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';
import type { RequestEvent } from '@sveltejs/kit';

let serverClient: FlagClient | null = null;

/**
 * Initialize the server-side Savvagent client.
 * Call this once in hooks.server.ts or root +layout.server.ts.
 *
 * @param config - Client configuration
 * @returns The FlagClient instance
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { initSvelteKitServer } from '@savvagent/sveltekit/server';
 *
 * initSvelteKitServer({
 *   apiKey: process.env.SAVVAGENT_API_KEY!,
 *   applicationId: process.env.SAVVAGENT_APP_ID,
 * });
 * ```
 */
export function initSvelteKitServer(config: FlagClientConfig): FlagClient {
  if (!serverClient) {
    serverClient = new FlagClient(config);
  }
  return serverClient;
}

/**
 * Get the server-side Savvagent client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getServerClient(): FlagClient {
  if (!serverClient) {
    throw new Error(
      'SvelteKit server client not initialized. Call initSvelteKitServer() first.'
    );
  }
  return serverClient;
}

/**
 * Extract context from SvelteKit RequestEvent.
 * Automatically extracts user_id from cookies and language from headers.
 *
 * @param event - SvelteKit RequestEvent
 * @param overrides - Additional context properties
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
  overrides?: FlagContext
): FlagContext {
  const context: FlagContext = {
    user_id: event.cookies.get('user_id'),
    anonymous_id: event.cookies.get('savvagent_anonymous_id'),
    session_id: event.cookies.get('session_id'),
    language: event.request.headers.get('accept-language')?.split(',')[0] || undefined,
    ...overrides,
  };

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
 * export async function load({ cookies, request }) {
 *   const enabled = await isEnabled('new-feature', {
 *     user_id: cookies.get('user_id'),
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
  const client = getServerClient();
  return client.isEnabled(flagKey, context);
}

/**
 * Evaluate a feature flag with detailed result.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<FlagEvaluationResult>
 */
export async function evaluate(flagKey: string, context?: FlagContext) {
  const client = getServerClient();
  return client.evaluate(flagKey, context);
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
  const client = getServerClient();
  return client.withFlag(flagKey, callback, context);
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
  event: Pick<RequestEvent, 'cookies' | 'request'>,
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const eventContext = getEventContext(event, context);
  return isEnabled(flagKey, eventContext);
}
