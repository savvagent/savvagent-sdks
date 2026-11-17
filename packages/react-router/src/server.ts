/**
 * Server-side flag evaluation for React Router 8 loaders, actions and middleware.
 */

import { FlagClient } from '@savvagent/sdk';
import type { FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import {
  DEFAULT_EVALUATION_TIMEOUT_MS,
  assignAnonymousId,
  buildRequestContext,
  createRequestScope,
  defaultReportError,
  isSecureUrl,
  mergeContext,
  parseCookies,
  resolveUserId,
  serializeAnonymousIdCookie,
  throttleErrors,
  toServerConfig,
} from '@savvagent/sdk/server';
import { createContext } from 'react-router';
import type { MiddlewareFunction, RouterContextProvider } from 'react-router';

// The request scope (cookies, context, user_id rules, bounded evaluation,
// error throttling) is the one shared by every server integration (#26).
export {
  ANONYMOUS_ID_COOKIE,
  USER_ID_COOKIE,
  SESSION_ID_COOKIE,
  DEFAULT_EVALUATION_TIMEOUT_MS,
  ERROR_REPORT_INTERVAL_MS,
  parseCookies,
  toServerConfig,
  throttleErrors,
} from '@savvagent/sdk/server';

/**
 * Flag results evaluated on the server, keyed by flag key. Return this from a
 * loader and pass it to `<SavvagentProvider flags={...}>` so the first client
 * render shows the server's values instead of defaults.
 */
export type SavvagentFlags = Record<string, FlagEvaluationResult>;

/** Arguments passed to {@link SavvagentServerOptions.getUserId}. */
export interface UserIdArgs {
  request: Request;
  /** The router context, when called from the middleware. */
  context?: Readonly<RouterContextProvider>;
}

export interface SavvagentServerOptions {
  /**
   * Context merged into every evaluation, under the per-request values.
   * Put app-wide values here, such as `environment` or `organization_id`.
   */
  defaultContext?: FlagContext;
  /**
   * Resolve the authenticated user's ID for a request from your own auth
   * (a session, a verified token, a value your auth middleware put in the
   * router context). This is the recommended source of `user_id`.
   *
   * Called once per request scope, bounded by `evaluationTimeoutMs`. A
   * non-empty string is the user; nothing keeps a trusted `user_id` cookie
   * (with `trustUserIdCookie`). If it throws, rejects or times out, the
   * failure goes to `onError` and the request is evaluated without any
   * `user_id`, the trusted cookie's included.
   */
  getUserId?: (args: UserIdArgs) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Read `user_id` from the `user_id` cookie. Off by default: the cookie is
   * set by the browser, so any visitor can claim any user ID and receive that
   * user's targeted flags. Enable it only for demos, or when nothing gated by
   * a flag is sensitive.
   */
  trustUserIdCookie?: boolean;
  /**
   * Set a `savvagent_anonymous_id` cookie for visitors who have none, so the
   * server and the browser SDK bucket a visitor the same way (default: true).
   */
  setAnonymousIdCookie?: boolean;
  /**
   * Upper bound on one flag evaluation, and on `getUserId`, in milliseconds (default: 1000). When
   * the Flags API is slow or down, the evaluation resolves with the flag's
   * default (`reason: 'error'`) instead of holding up the page.
   */
  evaluationTimeoutMs?: number;
}

/** Options for {@link SavvagentServer.forRequest}. */
export interface ForRequestOptions {
  /** The authenticated user's ID. Takes precedence over `getUserId` and cookies. */
  userId?: string | null;
  /** Extra context for every evaluation in this request. */
  context?: FlagContext;
}

/**
 * Flag evaluation scoped to one request. Each method merges the request's
 * context with the context you pass; values you pass win.
 */
export interface SavvagentRequest {
  /** The evaluation context derived from this request. */
  readonly context: FlagContext;
  /**
   * Headers to add to the response: a `Set-Cookie` for a newly assigned
   * anonymous ID, or nothing. The middleware adds them for you; without the
   * middleware, return them from your loader (`data(payload, { headers })`).
   */
  readonly headers: Headers;
  isEnabled(flagKey: string, context?: FlagContext): Promise<boolean>;
  evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult>;
  /** Evaluate several flags in parallel, for hydrating `<SavvagentProvider flags>`. */
  evaluateFlags(flagKeys: string[], context?: FlagContext): Promise<SavvagentFlags>;
  withFlag<T>(flagKey: string, callback: () => T | Promise<T>, context?: FlagContext): Promise<T | null>;
  trackError(flagKey: string, error: Error, context?: FlagContext): void;
}

export interface SavvagentServer {
  /**
   * The FlagClient shared by every request in the process, created on first
   * use. `null` if it could not be created (for example a missing API key);
   * evaluations then return the configured defaults. Never mutate it per
   * request (`setUserId`, `setOverride`, `setEnvironment`): pass context instead.
   */
  readonly client: FlagClient | null;
  /** Build the evaluation context for a request (cookies and `Accept-Language`). */
  getRequestContext(request: Request, overrides?: FlagContext): FlagContext;
  /** Flag evaluation scoped to one request. */
  forRequest(request: Request, options?: ForRequestOptions): Promise<SavvagentRequest>;
  /**
   * Route middleware that creates the request scope, makes it available to
   * loaders and actions through {@link getSavvagent}, and sets the anonymous
   * ID cookie on the response. Export it from `app/root.tsx`:
   * `export const middleware = [savvagent.middleware];`
   */
  readonly middleware: MiddlewareFunction<Response>;
  /** Close the shared client (timers, connections). */
  close(): void;
}

/** Router context key under which the middleware stores the request scope. */
export const savvagentContext = createContext<SavvagentRequest | null>(null);

/**
 * Read the request scope that {@link SavvagentServer.middleware} created.
 *
 * @example
 * ```ts
 * export async function loader({ context }: Route.LoaderArgs) {
 *   const savvagent = getSavvagent(context);
 *   return { flags: await savvagent.evaluateFlags(['new-checkout']) };
 * }
 * ```
 */
export function getSavvagent(context: Readonly<RouterContextProvider>): SavvagentRequest {
  const scope = context.get(savvagentContext);
  if (!scope) {
    throw new Error(
      '[Savvagent] No request scope in the router context. Add `export const middleware = ' +
        '[savvagent.middleware]` to app/root.tsx, or call `savvagent.forRequest(request)` instead.'
    );
  }
  return scope;
}

/**
 * Create the server-side Savvagent integration for a React Router app.
 * Call it once, in a server-only module such as `app/savvagent.server.ts`.
 *
 * One FlagClient is shared by all requests; its cache is keyed by evaluation
 * context, so users never see each other's results. User identity always
 * comes from the request (or from `getUserId`), never from client state.
 *
 * @example
 * ```ts
 * // app/savvagent.server.ts
 * import { createSavvagentServer } from '@savvagent/react-router';
 *
 * export const savvagent = createSavvagentServer(
 *   { apiKey: process.env.SAVVAGENT_FLAGS_API_KEY!, applicationId: 'my-app' },
 *   { getUserId: async ({ request }) => (await getSession(request)).get('userId') }
 * );
 * ```
 */
export function createSavvagentServer(
  config: FlagClientConfig,
  options: SavvagentServerOptions = {}
): SavvagentServer {
  let client: FlagClient | null = null;
  let failed = false;
  const timeoutMs = options.evaluationTimeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS;
  const reportError = throttleErrors(config.onError ?? defaultReportError);

  const getClient = (): FlagClient | null => {
    if (!client && !failed) {
      try {
        client = new FlagClient(toServerConfig({ ...config, onError: reportError }));
      } catch (error) {
        // Report once instead of failing every request.
        failed = true;
        console.error('[Savvagent] Could not create the server-side client:', error);
      }
    }
    return client;
  };

  const getRequestContext = (request: Request, overrides?: FlagContext): FlagContext =>
    buildRequestContext(
      {
        cookies: parseCookies(request.headers.get('cookie')),
        acceptLanguage: request.headers.get('accept-language'),
        trustUserIdCookie: options.trustUserIdCookie,
        defaultContext: options.defaultContext,
      },
      overrides
    );

  const createScope = async (
    request: Request,
    forOptions: ForRequestOptions = {},
    routerContext?: Readonly<RouterContextProvider>
  ): Promise<SavvagentRequest> => {
    const requestContext = getRequestContext(request);
    const headers = new Headers();

    if (forOptions.userId !== undefined) {
      if (forOptions.userId) requestContext.user_id = forOptions.userId;
      else delete requestContext.user_id;
    } else if (options.getUserId) {
      // Bounded, and anonymous (no user_id, a trusted cookie's included) on failure.
      const getUserId = options.getUserId;
      const result = await resolveUserId(() => getUserId({ request, context: routerContext }), {
        timeoutMs,
        reportError,
      });
      if (result.userId) requestContext.user_id = result.userId;
      else if (result.failed) delete requestContext.user_id;
    }

    // Always evaluate with a per-visitor anonymous ID, so the shared client's
    // own process-wide ID is never used for anyone.
    const { anonymousId, isNew } = assignAnonymousId(requestContext);
    if (isNew && options.setAnonymousIdCookie !== false) {
      // Not HttpOnly: the browser SDK reads it to bucket the visitor the same way.
      headers.append('Set-Cookie', serializeAnonymousIdCookie(anonymousId, { secure: isSecureUrl(request.url) }));
    }

    const scope = createRequestScope({
      client: getClient(),
      context: mergeContext(requestContext, forOptions.context),
      evaluationTimeoutMs: timeoutMs,
      reportError,
      defaults: config.defaults,
    });
    return {
      context: scope.context,
      headers,
      evaluate: scope.evaluate,
      isEnabled: scope.isEnabled,
      evaluateFlags: scope.evaluateFlags,
      withFlag: scope.withFlag,
      trackError: scope.trackError,
    };
  };

  const middleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
    // Mounted on nested routes: the outermost instance owns the scope and its cookies.
    if (context.get(savvagentContext)) return next();
    const requestScope = await createScope(request, {}, context);
    context.set(savvagentContext, requestScope);
    const response = await next();
    const cookies = requestScope.headers.getSetCookie();
    if (cookies.length === 0) return response;
    try {
      for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
      return response;
    } catch {
      // Headers of some responses (e.g. Response.redirect) are immutable.
      const copy = new Response(response.body, response);
      for (const cookie of cookies) copy.headers.append('Set-Cookie', cookie);
      return copy;
    }
  };

  return {
    get client() {
      return getClient();
    },
    getRequestContext,
    forRequest: (request, forOptions) => createScope(request, forOptions),
    middleware,
    close: () => {
      client?.close();
      client = null;
      failed = false;
    },
  };
}
