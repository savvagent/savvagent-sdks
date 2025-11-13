/**
 * Server-side utilities for Next.js Server Components, Route Handlers, and Server Actions
 */

import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';
import { cookies, headers } from 'next/headers';

// Global client instance for server-side usage
let serverClient: FlagClient | null = null;

/**
 * Initialize the server-side Savvagent client.
 * Call this once in your root layout or at application startup.
 *
 * @param config - Client configuration
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { initServerClient } from '@savvagent/nextjs/server';
 *
 * initServerClient({
 *   apiKey: process.env.SAVVAGENT_API_KEY!,
 *   applicationId: process.env.SAVVAGENT_APP_ID,
 * });
 * ```
 */
export function initServerClient(config: FlagClientConfig): void {
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
export function getServerClient(): FlagClient {
  if (!serverClient) {
    throw new Error(
      'Server client not initialized. Call initServerClient() first.'
    );
  }
  return serverClient;
}

/**
 * Create a context object from Next.js request headers and cookies.
 * Automatically extracts user_id from cookies and language from headers.
 *
 * @param overrides - Additional context properties
 * @returns FlagContext with request data
 *
 * @example
 * ```tsx
 * // Server Component
 * export default async function Page() {
 *   const context = await createServerContext();
 *   const enabled = await isEnabled('my-feature', context);
 *   // ...
 * }
 * ```
 */
export async function createServerContext(
  overrides?: FlagContext
): Promise<FlagContext> {
  const cookieStore = await cookies();
  const headersList = await headers();

  const context: FlagContext = {
    user_id: cookieStore.get('user_id')?.value,
    anonymous_id: cookieStore.get('savvagent_anonymous_id')?.value,
    session_id: cookieStore.get('session_id')?.value,
    language: headersList.get('accept-language')?.split(',')[0],
    ...overrides,
  };

  return context;
}

/**
 * Check if a feature flag is enabled in a Server Component.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<boolean>
 *
 * @example
 * ```tsx
 * // Server Component
 * import { isEnabled } from '@savvagent/nextjs/server';
 *
 * export default async function Page() {
 *   const enabled = await isEnabled('new-layout');
 *
 *   return enabled ? <NewLayout /> : <OldLayout />;
 * }
 * ```
 */
export async function isEnabled(
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const client = getServerClient();
  const serverContext = await createServerContext(context);
  return client.isEnabled(flagKey, serverContext);
}

/**
 * Evaluate a feature flag in a Server Component with detailed result.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<FlagEvaluationResult>
 *
 * @example
 * ```tsx
 * import { evaluate } from '@savvagent/nextjs/server';
 *
 * export default async function Page() {
 *   const result = await evaluate('premium-features');
 *
 *   if (result.value) {
 *     console.log('Flag enabled:', result.metadata);
 *   }
 *
 *   return <Component enabled={result.value} />;
 * }
 * ```
 */
export async function evaluate(flagKey: string, context?: FlagContext) {
  const client = getServerClient();
  const serverContext = await createServerContext(context);
  return client.evaluate(flagKey, serverContext);
}

/**
 * Execute code conditionally based on flag value in a Server Component or Server Action.
 *
 * @param flagKey - The flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param context - Optional context for targeting
 * @returns Promise with callback result or null
 *
 * @example
 * ```tsx
 * import { withFlag } from '@savvagent/nextjs/server';
 *
 * export default async function Page() {
 *   const data = await withFlag('use-new-api', async () => {
 *     return await fetchFromNewAPI();
 *   });
 *
 *   return data ? <NewView data={data} /> : <OldView />;
 * }
 * ```
 */
export async function withFlag<T>(
  flagKey: string,
  callback: () => T | Promise<T>,
  context?: FlagContext
): Promise<T | null> {
  const client = getServerClient();
  const serverContext = await createServerContext(context);
  return client.withFlag(flagKey, callback, serverContext);
}

/**
 * Track an error with flag context in a Server Action or Route Handler.
 *
 * @param flagKey - The flag key associated with the error
 * @param error - The error that occurred
 * @param context - Optional context
 *
 * @example
 * ```tsx
 * // Server Action
 * 'use server';
 *
 * import { trackError } from '@savvagent/nextjs/server';
 *
 * export async function submitForm(data: FormData) {
 *   try {
 *     await processWithNewAlgorithm(data);
 *   } catch (error) {
 *     trackError('new-algorithm', error as Error);
 *     throw error;
 *   }
 * }
 * ```
 */
export async function trackError(
  flagKey: string,
  error: Error,
  context?: FlagContext
): Promise<void> {
  const client = getServerClient();
  const serverContext = await createServerContext(context);
  client.trackError(flagKey, error, serverContext);
}

/**
 * Helper for Route Handlers to evaluate flags with request context.
 *
 * @param request - Next.js Request object
 * @param flagKey - The flag key to evaluate
 * @param context - Optional additional context
 * @returns Promise<boolean>
 *
 * @example
 * ```tsx
 * // app/api/data/route.ts
 * import { evaluateForRequest } from '@savvagent/nextjs/server';
 * import { NextRequest } from 'next/server';
 *
 * export async function GET(request: NextRequest) {
 *   const useNewAPI = await evaluateForRequest(request, 'new-api-version');
 *
 *   const data = useNewAPI
 *     ? await fetchFromNewAPI()
 *     : await fetchFromOldAPI();
 *
 *   return Response.json(data);
 * }
 * ```
 */
export async function evaluateForRequest(
  request: Request,
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((c) => {
      const [key, ...values] = c.split('=');
      return [key, values.join('=')];
    })
  );

  const requestContext: FlagContext = {
    user_id: cookies.user_id,
    anonymous_id: cookies.savvagent_anonymous_id,
    session_id: cookies.session_id,
    language: request.headers.get('accept-language')?.split(',')[0],
    ...context,
  };

  const client = getServerClient();
  return client.isEnabled(flagKey, requestContext);
}
