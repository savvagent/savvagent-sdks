/**
 * Middleware utilities for Next.js Edge Runtime
 */

import { NextRequest, NextResponse } from 'next/server';
import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';

let middlewareClient: FlagClient | null = null;

/**
 * Initialize the Savvagent client for middleware.
 * Call this at the top of your middleware.ts file.
 *
 * @param config - Client configuration
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
export function initMiddlewareClient(config: FlagClientConfig): void {
  if (!middlewareClient) {
    middlewareClient = new FlagClient(config);
  }
}

/**
 * Get the middleware client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getMiddlewareClient(): FlagClient {
  if (!middlewareClient) {
    throw new Error(
      'Middleware client not initialized. Call initMiddlewareClient() first.'
    );
  }
  return middlewareClient;
}

/**
 * Extract context from Next.js request.
 *
 * @param request - Next.js request
 * @param overrides - Additional context properties
 * @returns FlagContext with request data
 */
export function getRequestContext(
  request: NextRequest,
  overrides?: FlagContext
): FlagContext {
  const context: FlagContext = {
    user_id: request.cookies.get('user_id')?.value,
    anonymous_id: request.cookies.get('savvagent_anonymous_id')?.value,
    session_id: request.cookies.get('session_id')?.value,
    language: request.headers.get('accept-language')?.split(',')[0],
    ...overrides,
  };

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
  const client = getMiddlewareClient();
  const requestContext = getRequestContext(request, context);
  return client.isEnabled(flagKey, requestContext);
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
   * Custom logic to execute in middleware
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
 * import { initMiddlewareClient, createMiddleware } from '@savvagent/nextjs/middleware';
 *
 * initMiddlewareClient({
 *   apiKey: process.env.SAVVAGENT_API_KEY!,
 * });
 *
 * export default createMiddleware({
 *   async onRequest(request, client) {
 *     const context = { user_id: request.cookies.get('user_id')?.value };
 *     const showMaintenance = await client.isEnabled('maintenance-mode', context);
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
