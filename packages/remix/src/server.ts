/**
 * Server-side utilities for Remix loaders and actions
 */

import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';

// Module-level variable for the singleton client
// Exported for testing purposes only - do not use in production code
export let serverClient: FlagClient | null = null;

/**
 * Initialize the server-side Savvagent client.
 * Call this once in your root route or entry.server.tsx.
 *
 * @param config - Client configuration
 *
 * @example
 * ```tsx
 * // app/root.tsx
 * import { initRemixClient } from '@savvagent/remix';
 *
 * initRemixClient({
 *   apiKey: process.env.SAVVAGENT_API_KEY!,
 *   applicationId: process.env.SAVVAGENT_APP_ID,
 * });
 * ```
 */
export function initRemixClient(config: FlagClientConfig): void {
  if (!serverClient) {
    serverClient = new FlagClient(config);
  }
}

/**
 * Get the server-side Savvagent client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getRemixClient(): FlagClient {
  if (!serverClient) {
    throw new Error(
      'Remix client not initialized. Call initRemixClient() first.'
    );
  }
  return serverClient;
}

/**
 * Extract context from Remix request.
 * Automatically extracts user_id from cookies and language from headers.
 *
 * @param request - Remix request
 * @param overrides - Additional context properties
 * @returns FlagContext
 *
 * @example
 * ```tsx
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const context = getRequestContext(request, {
 *     attributes: { plan: 'pro' },
 *   });
 *   const enabled = await isEnabled('premium-feature', context);
 *   return json({ enabled });
 * }
 * ```
 */
export function getRequestContext(
  request: Request,
  overrides?: FlagContext
): FlagContext {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((c) => {
      const [key, ...values] = c.split('=');
      return [key, values.join('=')];
    })
  );

  const context: FlagContext = {
    user_id: cookies.user_id,
    anonymous_id: cookies.savvagent_anonymous_id,
    session_id: cookies.session_id,
    language: request.headers.get('accept-language')?.split(',')[0],
    ...overrides,
  };

  return context;
}

/**
 * Check if a feature flag is enabled in a Remix loader or action.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<boolean>
 *
 * @example
 * ```tsx
 * import { isEnabled } from '@savvagent/remix';
 * import { LoaderFunctionArgs } from '@remix-run/node';
 *
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const enabled = await isEnabled('new-feature', {
 *     user_id: await getUserId(request),
 *   });
 *
 *   return json({ enabled });
 * }
 * ```
 */
export async function isEnabled(
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const client = getRemixClient();
  return client.isEnabled(flagKey, context);
}

/**
 * Evaluate a feature flag with detailed result.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<FlagEvaluationResult>
 *
 * @example
 * ```tsx
 * import { evaluate } from '@savvagent/remix';
 *
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const result = await evaluate('beta-features');
 *
 *   return json({
 *     enabled: result.value,
 *     reason: result.reason,
 *   });
 * }
 * ```
 */
export async function evaluate(flagKey: string, context?: FlagContext) {
  const client = getRemixClient();
  return client.evaluate(flagKey, context);
}

/**
 * Execute code conditionally based on flag value in a loader or action.
 *
 * @param flagKey - The flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param context - Optional context for targeting
 * @returns Promise with callback result or null
 *
 * @example
 * ```tsx
 * import { withFlag } from '@savvagent/remix';
 *
 * export async function loader() {
 *   const data = await withFlag('use-new-api', async () => {
 *     return await fetchFromNewAPI();
 *   });
 *
 *   return json({ data });
 * }
 * ```
 */
export async function withFlag<T>(
  flagKey: string,
  callback: () => T | Promise<T>,
  context?: FlagContext
): Promise<T | null> {
  const client = getRemixClient();
  return client.withFlag(flagKey, callback, context);
}

/**
 * Track an error with flag context in an action.
 *
 * @param flagKey - The flag key associated with the error
 * @param error - The error that occurred
 * @param context - Optional context
 *
 * @example
 * ```tsx
 * import { trackError } from '@savvagent/remix';
 * import { ActionFunctionArgs } from '@remix-run/node';
 *
 * export async function action({ request }: ActionFunctionArgs) {
 *   try {
 *     await processForm(await request.formData());
 *     return json({ success: true });
 *   } catch (error) {
 *     trackError('new-form-processor', error as Error);
 *     return json({ error: 'Failed' }, { status: 500 });
 *   }
 * }
 * ```
 */
export function trackError(
  flagKey: string,
  error: Error,
  context?: FlagContext
): void {
  const client = getRemixClient();
  client.trackError(flagKey, error, context);
}

/**
 * Helper function to evaluate flags in loaders with automatic request context.
 *
 * @param request - Remix request
 * @param flagKey - The flag key to evaluate
 * @param context - Optional additional context
 * @returns Promise<boolean>
 *
 * @example
 * ```tsx
 * import { evaluateForRequest } from '@savvagent/remix';
 * import { LoaderFunctionArgs } from '@remix-run/node';
 *
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const showBeta = await evaluateForRequest(request, 'beta-ui');
 *
 *   return json({
 *     component: showBeta ? 'beta' : 'stable',
 *   });
 * }
 * ```
 */
export async function evaluateForRequest(
  request: Request,
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const requestContext = getRequestContext(request, context);
  return isEnabled(flagKey, requestContext);
}

/**
 * Set the environment for flag evaluation on the server.
 * Useful for dynamically switching environments.
 *
 * @param environment - The environment name (e.g., "development", "staging", "production")
 *
 * @example
 * ```tsx
 * import { setEnvironment } from '@savvagent/remix';
 *
 * // In a loader or action
 * export async function loader() {
 *   setEnvironment('staging');
 *   // ...
 * }
 * ```
 */
export function setEnvironment(environment: string): void {
  const client = getRemixClient();
  client.setEnvironment(environment);
}

/**
 * Get the current environment on the server.
 *
 * @returns The current environment name
 *
 * @example
 * ```tsx
 * import { getEnvironment } from '@savvagent/remix';
 *
 * export async function loader() {
 *   const env = getEnvironment();
 *   return json({ environment: env });
 * }
 * ```
 */
export function getEnvironment(): string {
  const client = getRemixClient();
  return client.getEnvironment();
}
