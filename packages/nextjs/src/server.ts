/**
 * Server-side utilities for Next.js Server Components, Route Handlers, and Server Actions
 */

import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import { cookies, headers } from 'next/headers';
import {
  BoundedClient,
  boundedEvaluate,
  boundedWithFlag,
  createBoundedClient,
  resolveUserId,
} from './bounded';

export { DEFAULT_EVALUATION_TIMEOUT_MS } from './bounded';

/** Options for {@link initServerClient}. */
export interface ServerClientOptions {
  /**
   * Resolve the authenticated user's ID from your own auth (a session, a
   * verified token). Called once per evaluation helper call, inside the
   * request, so it can use `cookies()`, `headers()` or your auth library.
   * `evaluateForRequest` passes it the request.
   * This is the recommended source of `user_id`. If it throws or rejects,
   * the error goes to `onError` and the flag is evaluated without a user.
   */
  getUserId?: (request?: Request) => string | null | undefined | Promise<string | null | undefined>;
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

// Global client instance for server-side usage
let serverClient: BoundedClient | null = null;
let serverOptions: ServerClientOptions = {};

function getBounded(): BoundedClient {
  if (!serverClient) {
    throw new Error(
      'Server client not initialized. Call initServerClient() first.'
    );
  }
  return serverClient;
}

/**
 * Initialize the server-side Savvagent client.
 * Call this once in your root layout or at application startup.
 *
 * The client makes one attempt per evaluation (`retryAttempts: 1`), opens
 * no realtime connection and does not detect a language from the server's
 * locale, unless `config` says otherwise. Each evaluation is bounded by
 * `options.evaluationTimeoutMs`, and `onError` reports the same message at
 * most once a minute, so an unreachable Flags API cannot stall every page.
 *
 * @param config - Client configuration
 * @param options - User identity and timeout options
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { initServerClient } from '@savvagent/nextjs/server';
 *
 * initServerClient(
 *   {
 *     apiKey: process.env.SAVVAGENT_API_KEY!,
 *     applicationId: process.env.SAVVAGENT_APP_ID,
 *   },
 *   { getUserId: async () => (await auth())?.user?.id }
 * );
 * ```
 */
export function initServerClient(config: FlagClientConfig, options: ServerClientOptions = {}): void {
  if (!serverClient) {
    serverClient = createBoundedClient(FlagClient, config, options.evaluationTimeoutMs);
    serverOptions = options;
  }
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
 * Create a context object from Next.js request headers and cookies.
 *
 * `user_id` comes from, in order: `overrides.user_id`, the `getUserId`
 * option, or the `user_id` cookie when `trustUserIdCookie` is set. The
 * cookie is not read otherwise, because the browser controls it.
 * `anonymous_id`, `session_id` and `language` come from the request.
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

  let userId: string | undefined;
  if (overrides?.user_id === undefined) {
    const { getUserId } = serverOptions;
    userId = await resolveUserId(getUserId && (() => getUserId()), serverClient?.reportError ?? console.error);
    if (userId === undefined && serverOptions.trustUserIdCookie) {
      userId = cookieStore.get('user_id')?.value;
    }
  }

  const context: FlagContext = {
    anonymous_id: cookieStore.get('savvagent_anonymous_id')?.value,
    session_id: cookieStore.get('session_id')?.value,
    language: headersList.get('accept-language')?.split(',')[0],
    ...overrides,
  };
  // An undefined `overrides.user_id` means "not given", not "no user".
  context.user_id = overrides?.user_id ?? userId;

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
  const bounded = getBounded();
  const serverContext = await createServerContext(context);
  return (await boundedEvaluate(bounded, flagKey, serverContext)).value;
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
export async function evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  const bounded = getBounded();
  const serverContext = await createServerContext(context);
  return boundedEvaluate(bounded, flagKey, serverContext);
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
  const bounded = getBounded();
  const serverContext = await createServerContext(context);
  return boundedWithFlag(bounded, flagKey, callback, serverContext);
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
  const bounded = getBounded();
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((c) => {
      const [key, ...values] = c.split('=');
      return [key, values.join('=')];
    })
  );

  let userId: string | undefined;
  if (context?.user_id === undefined) {
    const { getUserId } = serverOptions;
    userId = await resolveUserId(getUserId && (() => getUserId(request)), bounded.reportError);
    if (userId === undefined && serverOptions.trustUserIdCookie) {
      userId = cookies.user_id;
    }
  }

  const requestContext: FlagContext = {
    anonymous_id: cookies.savvagent_anonymous_id,
    session_id: cookies.session_id,
    language: request.headers.get('accept-language')?.split(',')[0],
    ...context,
  };
  requestContext.user_id = context?.user_id ?? userId;

  return (await boundedEvaluate(bounded, flagKey, requestContext)).value;
}

/**
 * Result of evaluating multiple flags
 */
export interface EvaluateMultipleResult {
  /**
   * Map of flag keys to their boolean values
   */
  values: Record<string, boolean>;
  /**
   * Map of flag keys to their detailed evaluation results
   */
  results: Record<string, FlagEvaluationResult>;
  /**
   * Map of flag keys to their errors (if any)
   */
  errors: Record<string, Error | null>;
}

/**
 * Options for evaluating multiple flags
 */
export interface EvaluateMultipleOptions {
  /**
   * Default values for flags (keyed by flag key)
   */
  defaultValues?: Record<string, boolean>;
}

/**
 * Evaluate multiple feature flags in a Server Component with a single call.
 * This is more efficient than calling evaluate() multiple times and is the
 * server-side equivalent of the useFlags hook.
 *
 * @param flagKeys - Array of flag keys to evaluate
 * @param context - Optional context for targeting
 * @param options - Optional configuration
 * @returns Promise<EvaluateMultipleResult>
 *
 * @example
 * ```tsx
 * // Server Component
 * import { evaluateMultiple } from '@savvagent/nextjs/server';
 *
 * export default async function Page() {
 *   const { values } = await evaluateMultiple(
 *     ['feature-a', 'feature-b', 'feature-c'],
 *     { user_id: 'user-123' }
 *   );
 *
 *   return (
 *     <div>
 *       {values['feature-a'] && <FeatureA />}
 *       {values['feature-b'] && <FeatureB />}
 *       {values['feature-c'] && <FeatureC />}
 *     </div>
 *   );
 * }
 * ```
 */
export async function evaluateMultiple(
  flagKeys: string[],
  context?: FlagContext,
  options?: EvaluateMultipleOptions
): Promise<EvaluateMultipleResult> {
  const bounded = getBounded();
  const serverContext = await createServerContext(context);

  const values: Record<string, boolean> = {};
  const results: Record<string, FlagEvaluationResult> = {};
  const errors: Record<string, Error | null> = {};

  // Evaluate all flags in parallel. Each evaluation is bounded and never
  // rejects; a failure or timeout is recorded in `errors` and the flag falls
  // back to `defaultValues`, then to the configured default.
  await Promise.all(
    flagKeys.map(async (flagKey) => {
      errors[flagKey] = null;
      let evalResult = await boundedEvaluate(bounded, flagKey, serverContext, (error) => {
        errors[flagKey] = error;
      });
      const defaults = options?.defaultValues;
      if (evalResult.reason === 'error' && defaults && Object.prototype.hasOwnProperty.call(defaults, flagKey)) {
        evalResult = { ...evalResult, value: defaults[flagKey] === true };
      }
      values[flagKey] = evalResult.value;
      results[flagKey] = evalResult;
    })
  );

  return { values, results, errors };
}

/**
 * Check multiple feature flags in a Server Component.
 * Simplified version of evaluateMultiple that returns just the boolean values.
 *
 * @param flagKeys - Array of flag keys to evaluate
 * @param context - Optional context for targeting
 * @param defaultValues - Optional default values map
 * @returns Promise<Record<string, boolean>>
 *
 * @example
 * ```tsx
 * // Server Component
 * import { isEnabledMultiple } from '@savvagent/nextjs/server';
 *
 * export default async function Page() {
 *   const flags = await isEnabledMultiple(
 *     ['dark-mode', 'new-layout', 'beta-features'],
 *     { user_id: 'user-123' }
 *   );
 *
 *   return (
 *     <div className={flags['dark-mode'] ? 'dark' : 'light'}>
 *       {flags['new-layout'] ? <NewLayout /> : <OldLayout />}
 *     </div>
 *   );
 * }
 * ```
 */
export async function isEnabledMultiple(
  flagKeys: string[],
  context?: FlagContext,
  defaultValues?: Record<string, boolean>
): Promise<Record<string, boolean>> {
  const { values } = await evaluateMultiple(flagKeys, context, { defaultValues });
  return values;
}
