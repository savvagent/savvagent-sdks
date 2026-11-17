/**
 * Middleware utilities for Next.js Edge Runtime
 */

import { NextRequest, NextResponse } from 'next/server';
import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';
import {
  ANONYMOUS_ID_COOKIE,
  ServerClient,
  anonymousIdCookieOptions,
  buildRequestContext,
  createRequestScope,
  createServerClient,
  fallbackResult,
  isSecureUrl,
  newAnonymousId,
  serializeAnonymousIdCookie,
} from '@savvagent/sdk/server';

/** Options for {@link initMiddlewareClient}. */
export interface MiddlewareClientOptions {
  /**
   * Resolve the authenticated user's ID for a request from your own auth
   * (for example a verified session token). This is the recommended source
   * of `user_id`. It is bounded by `evaluationTimeoutMs`; if it throws,
   * rejects or times out, the failure goes to `onError` and the flag is
   * evaluated without a user (also without a trusted `user_id` cookie).
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
   * Upper bound on one flag evaluation, and on `getUserId`, in milliseconds
   * (default: 1000).
   * When the Flags API is slow or down, the flag evaluates to its default
   * instead of holding up the request.
   */
  evaluationTimeoutMs?: number;
}

let middlewareClient: ServerClient<FlagClient> | null = null;
let middlewareOptions: MiddlewareClientOptions = {};

function getBounded(): ServerClient<FlagClient> {
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
 *   apiKey: process.env.SAVVAGENT_FLAGS_API_KEY!,
 * });
 *
 * export default createMiddleware({
 *   // middleware config
 * });
 * ```
 */
export function initMiddlewareClient(config: FlagClientConfig, options: MiddlewareClientOptions = {}): void {
  if (!middlewareClient) {
    middlewareClient = createServerClient(FlagClient, config, { evaluationTimeoutMs: options.evaluationTimeoutMs });
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

/** Anonymous IDs assigned to requests that arrived without the cookie. */
const assignedIds = new WeakMap<object, string>();

/**
 * The visitor's anonymous ID: the `savvagent_anonymous_id` cookie, or a new
 * ID assigned to this request (the same one on every call for the request).
 * {@link createMiddleware}, {@link redirectIfEnabled} and
 * {@link rewriteIfEnabled} store a new ID in the cookie; in your own
 * middleware, call {@link setAnonymousIdCookie} on the response you return.
 */
export function getAnonymousId(request: NextRequest): string {
  const fromCookie = request.cookies.get(ANONYMOUS_ID_COOKIE)?.value;
  if (fromCookie) return fromCookie;
  let anonymousId = assignedIds.get(request);
  if (!anonymousId) {
    anonymousId = newAnonymousId();
    assignedIds.set(request, anonymousId);
  }
  return anonymousId;
}

/** The anonymous ID assigned to this request, if it arrived without the cookie and one was assigned. */
function newIdOf(request: NextRequest): string | undefined {
  return request.cookies.get(ANONYMOUS_ID_COOKIE)?.value ? undefined : assignedIds.get(request);
}

/**
 * Whether the visitor reached the site over https: the request URL, or the
 * `x-forwarded-proto` header a TLS-terminating proxy sets (as the server
 * helpers read it).
 */
function isSecureRequest(request: NextRequest): boolean {
  return (
    request.nextUrl?.protocol === 'https:' ||
    isSecureUrl(request.url) ||
    request.headers?.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
  );
}

/**
 * Add a `Set-Cookie` for the anonymous ID assigned to this request to
 * `response`, if one was assigned (the request had no
 * `savvagent_anonymous_id` cookie). The cookie is not HttpOnly, so the
 * browser SDK buckets the visitor the same way; it has `Path=/`,
 * `SameSite=Lax`, a one-year lifetime and `Secure` on https.
 *
 * Returns `response`, or a copy of it when its headers are immutable.
 */
export function setAnonymousIdCookie<T extends Response>(request: NextRequest, response: T): T {
  const anonymousId = newIdOf(request);
  if (!anonymousId) return response;
  const secure = isSecureRequest(request);
  const responseCookies = (response as unknown as Partial<NextResponse>).cookies;
  if (responseCookies && typeof responseCookies.set === 'function') {
    responseCookies.set(ANONYMOUS_ID_COOKIE, anonymousId, anonymousIdCookieOptions(secure));
    return response;
  }
  const cookie = serializeAnonymousIdCookie(anonymousId, { secure });
  try {
    response.headers.append('Set-Cookie', cookie);
    return response;
  } catch {
    // Headers of some responses (e.g. Response.redirect) are immutable.
    const copy = new Response(response.body, response);
    copy.headers.append('Set-Cookie', cookie);
    return copy as T;
  }
}

/**
 * Request headers that carry a newly assigned anonymous ID in `Cookie`, so
 * the pages rendered for this request see the same ID as the middleware.
 * Undefined when the request already had the cookie.
 */
function forwardedRequestHeaders(request: NextRequest): Headers | undefined {
  const anonymousId = newIdOf(request);
  if (!anonymousId) return undefined;
  const requestHeaders = new Headers(request.headers);
  const existing = request.headers.get('cookie');
  const added = `${ANONYMOUS_ID_COOKIE}=${encodeURIComponent(anonymousId)}`;
  requestHeaders.set('cookie', existing ? `${existing}; ${added}` : added);
  return requestHeaders;
}

/**
 * Extract context from Next.js request.
 *
 * Reads `user_id` from the `user_id` cookie only when `trustUserIdCookie`
 * is set (here or in `initMiddlewareClient`), because the browser controls
 * that cookie. It does not call `getUserId`; {@link isEnabledInMiddleware}
 * and the redirect/rewrite helpers do. `anonymous_id` is the visitor's
 * anonymous ID (see {@link getAnonymousId}).
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
  const context = buildRequestContext(
    {
      cookies: (name) => request.cookies.get(name)?.value,
      acceptLanguage: request.headers.get('accept-language'),
      trustUserIdCookie: options?.trustUserIdCookie ?? middlewareOptions.trustUserIdCookie ?? false,
    },
    overrides
  );
  if (!context.anonymous_id) context.anonymous_id = getAnonymousId(request);
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
  const { getUserId } = middlewareOptions;
  const scope = createRequestScope({
    client: bounded.client,
    context: getRequestContext(request, context),
    userId: context?.user_id,
    getUserId: getUserId && (() => getUserId(request)),
    evaluationTimeoutMs: bounded.timeoutMs,
    reportError: bounded.reportError,
    // A failed evaluation: the flag's default, `reason: 'error'`, with a timestamp.
    fallback: (flagKey) => fallbackResult(flagKey, bounded.config.defaults, { timestamp: true }),
  });
  return scope.isEnabled(flagKey, context);
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
 * A visitor without a `savvagent_anonymous_id` cookie gets a new anonymous
 * ID: `onRequest` and the pages rendered for this request see it, and the
 * response (yours from `onRequest`, or `NextResponse.next()`) sets the
 * cookie, so the visitor keeps one rollout bucket on the server and in the
 * browser.
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
 *   apiKey: process.env.SAVVAGENT_FLAGS_API_KEY!,
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
    // Assigned up front so evaluations in onRequest and the pages use one ID.
    getAnonymousId(request);

    if (config?.onRequest) {
      const result = await config.onRequest(request, client);
      if (result) {
        return setAnonymousIdCookie(request, result);
      }
    }

    const requestHeaders = forwardedRequestHeaders(request);
    const response = requestHeaders ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.next();
    return setAnonymousIdCookie(request, response);
  };
}

/**
 * Helper to create a feature flag-based redirect in middleware. The
 * redirect sets the anonymous ID cookie when this request assigned one.
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
    return setAnonymousIdCookie(request, NextResponse.redirect(new URL(redirectUrl, request.url)));
  }

  return null;
}

/**
 * Helper to create a feature flag-based rewrite in middleware. The
 * rewritten page sees the anonymous ID assigned to this request, and the
 * response sets its cookie.
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
    const requestHeaders = forwardedRequestHeaders(request);
    const response = requestHeaders
      ? NextResponse.rewrite(new URL(rewriteUrl, request.url), { request: { headers: requestHeaders } })
      : NextResponse.rewrite(new URL(rewriteUrl, request.url));
    return setAnonymousIdCookie(request, response);
  }

  return null;
}
