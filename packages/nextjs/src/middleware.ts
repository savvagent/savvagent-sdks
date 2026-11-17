/**
 * Middleware utilities for Next.js Edge Runtime
 */

import { NextRequest, NextResponse } from 'next/server';
import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';
import { BoundedClient, boundedEvaluate, createBoundedClient, resolveUserId } from './bounded';

/** Options for {@link initMiddlewareClient}. */
export interface MiddlewareClientOptions {
  /**
   * Resolve the authenticated user's ID for a request from your own auth
   * (for example a verified session token). This is the recommended source
   * of `user_id`. If it throws or rejects, the error goes to `onError` and
   * the flag is evaluated without a user.
   */
  getUserId?: (request: NextRequest) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Read `user_id` from the `user_id` cookie. Off by default: the browser
   * sets that cookie, so any visitor can claim another user's ID, receive
   * that user's targeted flags and steer flag-based redirects and rewrites.
   * Enable it only for demos.
   */
  trustUserIdCookie?: boolean;
  /**
   * Upper bound on one flag evaluation, in milliseconds (default: 1000).
   * When the Flags API is slow or down, the flag evaluates to its default
   * instead of holding up the request.
   */
  evaluationTimeoutMs?: number;
}

let middlewareClient: BoundedClient | null = null;
let middlewareOptions: MiddlewareClientOptions = {};

function getBounded(): BoundedClient {
  if (!middlewareClient) {
    throw new Error(
      'Middleware client not initialized. Call initMiddlewareClient() first.'
    );
  }
  return middlewareClient;
}

/**
 * Initialize the Savvagent client for middleware.
 * Call this at the top of your middleware.ts file.
 *
 * The client makes one attempt per evaluation and opens no realtime
 * connection unless `config` says otherwise, and the helpers in this module
 * bound each evaluation by `options.evaluationTimeoutMs`.
 *
 * @param config - Client configuration
 * @param options - User identity and timeout options
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { initMiddlewareClient, createMiddleware } from '@savvagent/nextjs/middleware';
 *
 * initMiddlewareClient({
 *   apiKey: process.env.SAVVAGENT_API_KEY!,
 * });
 *
 * export default createMiddleware({
 *   // middleware config
 * });
 * ```
 */
export function initMiddlewareClient(config: FlagClientConfig, options: MiddlewareClientOptions = {}): void {
  if (!middlewareClient) {
    middlewareClient = createBoundedClient(FlagClient, config, options.evaluationTimeoutMs);
    middlewareOptions = options;
  }
}

/**
 * Get the middleware client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getMiddlewareClient(): FlagClient {
  return getBounded().client;
}

/**
 * Extract context from Next.js request.
 *
 * Reads `user_id` from the `user_id` cookie only when `trustUserIdCookie`
 * is set (here or in `initMiddlewareClient`), because the browser controls
 * that cookie. It does not call `getUserId`; {@link isEnabledInMiddleware}
 * and the redirect/rewrite helpers do.
 *
 * @param request - Next.js request
 * @param overrides - Additional context properties
 * @param options - `trustUserIdCookie` for this call
 * @returns FlagContext with request data
 */
export function getRequestContext(
  request: NextRequest,
  overrides?: FlagContext,
  options?: { trustUserIdCookie?: boolean }
): FlagContext {
  const trustCookie = options?.trustUserIdCookie ?? middlewareOptions.trustUserIdCookie ?? false;
  const context: FlagContext = {
    anonymous_id: request.cookies.get('savvagent_anonymous_id')?.value,
    session_id: request.cookies.get('session_id')?.value,
    language: request.headers.get('accept-language')?.split(',')[0],
    ...overrides,
  };
  // An undefined `overrides.user_id` means "not given", not "no user".
  context.user_id = overrides?.user_id ?? (trustCookie ? request.cookies.get('user_id')?.value : undefined);

  return context;
}

/**
 * Check if a flag is enabled in middleware.
 *
 * @param request - Next.js request
 * @param flagKey - The flag key to evaluate
 * @param context - Optional additional context
 * @returns Promise<boolean>
 *
 * @example
 * ```ts
 * import { isEnabledInMiddleware } from '@savvagent/nextjs/middleware';
 *
 * export async function middleware(request: NextRequest) {
 *   const useBeta = await isEnabledInMiddleware(request, 'beta-access');
 *
 *   if (useBeta && request.nextUrl.pathname === '/') {
 *     return NextResponse.rewrite(new URL('/beta', request.url));
 *   }
 * }
 * ```
 */
export async function isEnabledInMiddleware(
  request: NextRequest,
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const bounded = getBounded();
  const requestContext = getRequestContext(request, context);
  if (context?.user_id === undefined) {
    const { getUserId } = middlewareOptions;
    const userId = await resolveUserId(getUserId && (() => getUserId(request)), bounded.reportError);
    if (userId !== undefined) requestContext.user_id = userId;
  }
  return (await boundedEvaluate(bounded, flagKey, requestContext)).value;
}

/**
 * Configuration for the Savvagent middleware.
 */
export interface MiddlewareConfig {
  /**
   * Paths to match for middleware execution
   * @default ['/((?!api|_next/static|_next/image|favicon.ico).*)']
   */
  matcher?: string | string[];

  /**
   * Custom logic to execute in middleware. `client` is the raw FlagClient:
   * its calls are not bounded by `evaluationTimeoutMs`. Prefer
   * {@link isEnabledInMiddleware}, which is.
   */
  onRequest?: (
    request: NextRequest,
    client: FlagClient
  ) => Promise<NextResponse | void>;
}

/**
 * Create a Next.js middleware with Savvagent integration.
 *
 * @param config - Middleware configuration
 * @returns Next.js middleware function
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { initMiddlewareClient, createMiddleware, isEnabledInMiddleware } from '@savvagent/nextjs/middleware';
 *
 * initMiddlewareClient({
 *   apiKey: process.env.SAVVAGENT_API_KEY!,
 * });
 *
 * export default createMiddleware({
 *   async onRequest(request) {
 *     const showMaintenance = await isEnabledInMiddleware(request, 'maintenance-mode');
 *
 *     if (showMaintenance) {
 *       return NextResponse.rewrite(new URL('/maintenance', request.url));
 *     }
 *   },
 * });
 *
 * export const config = {
 *   matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
 * };
 * ```
 */
export function createMiddleware(config?: MiddlewareConfig) {
  return async function middleware(request: NextRequest) {
    const client = getMiddlewareClient();

    if (config?.onRequest) {
      const result = await config.onRequest(request, client);
      if (result) {
        return result;
      }
    }

    return NextResponse.next();
  };
}

/**
 * Helper to create a feature flag-based redirect in middleware.
 *
 * @param request - Next.js request
 * @param flagKey - The flag key to check
 * @param redirectUrl - URL to redirect to if flag is enabled
 * @param context - Optional context
 * @returns Promise<NextResponse | null>
 *
 * @example
 * ```ts
 * import { redirectIfEnabled } from '@savvagent/nextjs/middleware';
 *
 * export async function middleware(request: NextRequest) {
 *   // Redirect to new onboarding if flag is enabled
 *   const redirect = await redirectIfEnabled(
 *     request,
 *     'new-onboarding',
 *     '/onboarding-v2'
 *   );
 *   if (redirect) return redirect;
 * }
 * ```
 */
export async function redirectIfEnabled(
  request: NextRequest,
  flagKey: string,
  redirectUrl: string,
  context?: FlagContext
): Promise<NextResponse | null> {
  const enabled = await isEnabledInMiddleware(request, flagKey, context);

  if (enabled) {
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  }

  return null;
}

/**
 * Helper to create a feature flag-based rewrite in middleware.
 *
 * @param request - Next.js request
 * @param flagKey - The flag key to check
 * @param rewriteUrl - URL to rewrite to if flag is enabled
 * @param context - Optional context
 * @returns Promise<NextResponse | null>
 *
 * @example
 * ```ts
 * import { rewriteIfEnabled } from '@savvagent/nextjs/middleware';
 *
 * export async function middleware(request: NextRequest) {
 *   // Serve beta version if flag is enabled
 *   const rewrite = await rewriteIfEnabled(
 *     request,
 *     'beta-ui',
 *     '/beta' + request.nextUrl.pathname
 *   );
 *   if (rewrite) return rewrite;
 * }
 * ```
 */
export async function rewriteIfEnabled(
  request: NextRequest,
  flagKey: string,
  rewriteUrl: string,
  context?: FlagContext
): Promise<NextResponse | null> {
  const enabled = await isEnabledInMiddleware(request, flagKey, context);

  if (enabled) {
    return NextResponse.rewrite(new URL(rewriteUrl, request.url));
  }

  return null;
}
