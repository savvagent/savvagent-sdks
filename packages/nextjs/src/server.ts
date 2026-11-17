/**
 * Server-side utilities for Next.js Server Components, Route Handlers, and Server Actions
 */

import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import {
  ANONYMOUS_ID_COOKIE,
  RequestScope,
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
  parseCookies,
} from '@savvagent/sdk/server';
import { cookies, headers } from 'next/headers';
import * as React from 'react';

export { DEFAULT_EVALUATION_TIMEOUT_MS } from '@savvagent/sdk/server';

/** Options for {@link initServerClient}. */
export interface ServerClientOptions {
  /**
   * Resolve the authenticated user's ID from your own auth (a session, a
   * verified token). Called once per evaluation helper call, inside the
   * request, so it can use `cookies()`, `headers()` or your auth library.
   * `evaluateForRequest` passes it the request.
   * This is the recommended source of `user_id`. It is bounded by
   * `evaluationTimeoutMs`; if it throws, rejects or times out, the failure
   * goes to `onError` and the flag is evaluated without a user (also
   * without a trusted `user_id` cookie).
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
   * Upper bound on one flag evaluation, and on `getUserId`, in milliseconds
   * (default: 1000). When the Flags API is slow or down, the evaluation
   * resolves with the flag's default (`reason: 'error'`) instead of holding
   * up the page.
   */
  evaluationTimeoutMs?: number;
}

// Global client instance for server-side usage
let serverClient: ServerClient<FlagClient> | null = null;
let serverOptions: ServerClientOptions = {};

function getBounded(): ServerClient<FlagClient> {
  if (!serverClient) {
    throw new Error(
      'Server client not initialized. Call initServerClient() first.'
    );
  }
  return serverClient;
}

/** A failed evaluation: the flag's default, `reason: 'error'`, with a timestamp. */
function fallbackFor(config: FlagClientConfig | undefined) {
  return (flagKey: string): FlagEvaluationResult => ({
    ...fallbackResult(flagKey, config?.defaults),
    metadata: { timestamp: Date.now() },
  });
}

/**
 * React's `cache`, which memoizes per request on the server. React exports it
 * only under the `react-server` condition (App Router); in the Pages Router or
 * with React 18 outside Server Components it is missing. Read it from the
 * namespace, so a missing export is `undefined` rather than an import error.
 */
const reactCache = (React as { cache?: <T extends (...args: never[]) => unknown>(fn: T) => T }).cache;

/**
 * The anonymous ID of a visitor who has no `savvagent_anonymous_id` cookie
 * yet, one per request where React's `cache` exists. Without it, each call
 * gets a new ID (stored in the cookie where Next.js allows it). The
 * middleware from `@savvagent/nextjs/middleware` normally assigns the ID
 * before the page renders; this covers apps without it.
 */
const requestAnonymousId: () => string =
  typeof reactCache === 'function' ? reactCache((): string => newAnonymousId()) : () => newAnonymousId();

/**
 * Store a newly assigned anonymous ID in the visitor's cookie. Next.js
 * allows that in Server Actions and Route Handlers only; in a Server
 * Component `set` throws, and the ID stays per request until the middleware
 * (or a later action) stores one.
 */
function storeAnonymousId(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  anonymousId: string,
  secure: boolean
): void {
  try {
    cookieStore.set(ANONYMOUS_ID_COOKIE, anonymousId, anonymousIdCookieOptions(secure));
  } catch {
    // Expected in Server Components (read-only cookies); see above.
  }
}

/** Whether the request reached Next.js over https, from the `x-forwarded-proto` header Next.js sets. */
function forwardedHttps(headersList: Awaited<ReturnType<typeof headers>>): boolean {
  return headersList.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}

/** Scope options shared by every helper: the client, its bound, reporter and fallback. */
function scopeOptions(bounded: ServerClient<FlagClient> | null) {
  return {
    client: bounded?.client ?? null,
    evaluationTimeoutMs: bounded?.timeoutMs,
    reportError: bounded?.reportError ?? defaultReportError,
    fallback: fallbackFor(bounded?.config),
  };
}

/**
 * The request scope of the current Server Component, Server Action or
 * Route Handler, from `cookies()` and `headers()`. `overrides.user_id`, when
 * given, is used instead of `getUserId` and the cookie.
 */
async function serverScope(overrides?: FlagContext): Promise<RequestScope> {
  const cookieStore = await cookies();
  const headersList = await headers();
  const context = buildRequestContext({
    cookies: (name) => cookieStore.get(name)?.value,
    acceptLanguage: headersList.get('accept-language'),
    trustUserIdCookie: serverOptions.trustUserIdCookie,
  });
  // An anonymous_id passed by the caller needs no new one.
  if (!context.anonymous_id && !overrides?.anonymous_id) {
    context.anonymous_id = requestAnonymousId();
    storeAnonymousId(cookieStore, context.anonymous_id, forwardedHttps(headersList));
  }
  const { getUserId } = serverOptions;
  return createRequestScope({
    ...scopeOptions(serverClient),
    context,
    userId: overrides?.user_id,
    getUserId: getUserId && (() => getUserId()),
  });
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
    serverClient = createServerClient(FlagClient, config, { evaluationTimeoutMs: options.evaluationTimeoutMs });
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
 * `session_id` and `language` come from the request. `anonymous_id` comes
 * from the `savvagent_anonymous_id` cookie; a visitor without one gets a
 * new ID for this request, stored in the cookie where Next.js allows it
 * (Server Actions and Route Handlers; the middleware stores it for pages).
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
  const scope = await serverScope(overrides);
  return scope.resolveContext(overrides);
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
  getBounded();
  return (await serverScope(context)).isEnabled(flagKey, context);
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
  getBounded();
  return (await serverScope(context)).evaluate(flagKey, context);
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
  getBounded();
  return (await serverScope(context)).withFlag(flagKey, callback, context);
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
  const requestContext = buildRequestContext({
    cookies: parseCookies(request.headers.get('cookie')),
    acceptLanguage: request.headers.get('accept-language'),
    trustUserIdCookie: serverOptions.trustUserIdCookie,
  });
  if (!requestContext.anonymous_id && !context?.anonymous_id) {
    requestContext.anonymous_id = anonymousIdFor(request);
    try {
      storeAnonymousId(await cookies(), requestContext.anonymous_id, isSecureUrl(request.url));
    } catch {
      // Outside a Next.js request scope there is no cookie store to write to.
    }
  }
  const { getUserId } = serverOptions;
  const scope = createRequestScope({
    ...scopeOptions(bounded),
    context: requestContext,
    userId: context?.user_id,
    getUserId: getUserId && (() => getUserId(request)),
  });
  return scope.isEnabled(flagKey, context);
}

/** Anonymous IDs assigned to requests without the cookie, so repeated calls agree. */
const requestIds = new WeakMap<Request, string>();

function anonymousIdFor(request: Request): string {
  let anonymousId = requestIds.get(request);
  if (!anonymousId) {
    anonymousId = newAnonymousId();
    requestIds.set(request, anonymousId);
  }
  return anonymousId;
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
  const serverContext = await (await serverScope(context)).resolveContext(context);
  const { reportError, fallback } = scopeOptions(bounded);

  const values: Record<string, boolean> = {};
  const results: Record<string, FlagEvaluationResult> = {};
  const errors: Record<string, Error | null> = {};

  // Evaluate all flags in parallel. Each evaluation is bounded and never
  // rejects; a failure or timeout is recorded in `errors` and the flag falls
  // back to `defaultValues`, then to the configured default.
  await Promise.all(
    flagKeys.map(async (flagKey) => {
      errors[flagKey] = null;
      let evalResult = await evaluateBounded(bounded.client, flagKey, serverContext, {
        timeoutMs: bounded.timeoutMs,
        reportError,
        fallback,
        onFailure: (error) => {
          errors[flagKey] = error;
        },
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
