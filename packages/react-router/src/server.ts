/**
 * Server-side flag evaluation for React Router 8 loaders, actions and middleware.
 */

import { FlagClient } from '@savvagent/sdk';
import type { FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import { createContext } from 'react-router';
import type { MiddlewareFunction, RouterContextProvider } from 'react-router';

/** Cookie that keeps a visitor's anonymous ID stable across requests. */
export const ANONYMOUS_ID_COOKIE = 'savvagent_anonymous_id';
/** Cookie read for `user_id` only when `trustUserIdCookie` is enabled. */
export const USER_ID_COOKIE = 'user_id';
/** Cookie read for `session_id`. */
export const SESSION_ID_COOKIE = 'session_id';

const ANONYMOUS_ID_MAX_AGE = 60 * 60 * 24 * 365;
/** Default bound on one server-side evaluation, in milliseconds. */
export const DEFAULT_EVALUATION_TIMEOUT_MS = 1000;
/** Window in which the same error message is reported to `onError` only once. */
export const ERROR_REPORT_INTERVAL_MS = 60_000;

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
   * Upper bound on one flag evaluation, in milliseconds (default: 1000). When
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
 * Apply server-side defaults to a client config: no realtime (SSE)
 * connection, no language detection from the server's own locale, and a
 * single attempt per evaluation (no retries while a page waits).
 */
export function toServerConfig(config: FlagClientConfig): FlagClientConfig {
  return {
    ...config,
    enableRealtime: config.enableRealtime ?? false,
    disableLanguageDetection: config.disableLanguageDetection ?? true,
    retryAttempts: config.retryAttempts ?? 1,
  };
}

/**
 * Wrap an error handler so the same error message is reported at most once
 * per `intervalMs`. When the Flags API is down, every request fails the same
 * way; this keeps the logs readable.
 */
const MAX_THROTTLED_MESSAGES = 100;

/** @internal Exported for tests only. */
export function throttleErrors(
  onError: (error: Error) => void,
  intervalMs: number = ERROR_REPORT_INTERVAL_MS
): (error: Error) => void {
  const lastReported = new Map<string, number>();
  return (error: Error) => {
    const now = Date.now();
    const key = error?.message ?? String(error);
    const last = lastReported.get(key);
    if (last !== undefined && now - last < intervalMs) return;
    if (lastReported.size >= MAX_THROTTLED_MESSAGES) {
      for (const [message, time] of lastReported) {
        if (now - time >= intervalMs) lastReported.delete(message);
      }
      // Hard cap: messages can carry dynamic text (URLs, IDs), so drop the
      // oldest entries rather than letting the map grow during an outage.
      while (lastReported.size >= MAX_THROTTLED_MESSAGES) {
        lastReported.delete(lastReported.keys().next().value as string);
      }
    }
    // Delete first so a re-reported message moves to the end: the cap then
    // evicts the least recently reported message.
    lastReported.delete(key);
    lastReported.set(key, now);
    onError(error);
  };
}

/** Parse a `Cookie` header into a name/value map. */
export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    const raw = part.slice(index + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

function newAnonymousId(): string {
  return `anon_${globalThis.crypto.randomUUID()}`;
}

/** Drop keys whose value is undefined, null or '' so they never override. */
function compact(context: FlagContext): FlagContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as FlagContext;
}

function mergeContext(base: FlagContext, extra?: FlagContext): FlagContext {
  if (!extra) return base;
  const merged: FlagContext = { ...base, ...compact(extra) };
  if (base.attributes || extra.attributes) {
    merged.attributes = { ...base.attributes, ...extra.attributes };
  }
  return merged;
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
 *   { apiKey: process.env.SAVVAGENT_SDK_KEY!, applicationId: 'my-app' },
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
  const reportError = throttleErrors(config.onError ?? ((error) => console.error('[Savvagent]', error)));

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

  const getRequestContext = (request: Request, overrides?: FlagContext): FlagContext => {
    const cookies = parseCookies(request.headers.get('cookie'));
    const fromRequest = compact({
      user_id: options.trustUserIdCookie ? cookies[USER_ID_COOKIE] : undefined,
      anonymous_id: cookies[ANONYMOUS_ID_COOKIE],
      session_id: cookies[SESSION_ID_COOKIE],
      language: request.headers.get('accept-language')?.split(',')[0]?.split(';')[0]?.trim(),
    });
    return mergeContext(mergeContext(options.defaultContext ?? {}, fromRequest), overrides);
  };

  const scope = (requestContext: FlagContext, headers: Headers): SavvagentRequest => {
    const merge = (context?: FlagContext) => mergeContext(requestContext, context);
    const defaultFor = (flagKey: string) => config.defaults?.[flagKey] ?? false;

    const fallback = (flagKey: string): FlagEvaluationResult => ({
      key: flagKey,
      value: defaultFor(flagKey),
      reason: 'error',
    });

    const evaluate = async (flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> => {
      const flagClient = getClient();
      if (!flagClient) return fallback(flagKey);
      // Bound the evaluation so a slow or unreachable API cannot hold up the page.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<FlagEvaluationResult>((resolve) => {
        timer = setTimeout(() => {
          reportError(new Error(`Flag evaluation (${flagKey}) timed out after ${timeoutMs}ms`));
          resolve(fallback(flagKey));
        }, timeoutMs);
      });
      try {
        return await Promise.race([flagClient.evaluate(flagKey, merge(context)), timedOut]);
      } finally {
        clearTimeout(timer);
      }
    };

    const trackError = (flagKey: string, error: Error, context?: FlagContext) => {
      getClient()?.trackError(flagKey, error, merge(context));
    };

    return {
      context: requestContext,
      headers,
      evaluate,
      isEnabled: async (flagKey, context) => (await evaluate(flagKey, context)).value,
      evaluateFlags: async (flagKeys, context) => {
        const results = await Promise.all(flagKeys.map((flagKey) => evaluate(flagKey, context)));
        return Object.fromEntries(results.map((result, i) => [flagKeys[i], result]));
      },
      withFlag: async (flagKey, callback, context) => {
        // Uses the bounded evaluation; errors are tracked against the flag, then re-thrown.
        if (!(await evaluate(flagKey, context)).value) return null;
        try {
          return await callback();
        } catch (error) {
          trackError(flagKey, error as Error, context);
          throw error;
        }
      },
      trackError,
    };
  };

  const createScope = async (
    request: Request,
    forOptions: ForRequestOptions = {},
    routerContext?: Readonly<RouterContextProvider>
  ): Promise<SavvagentRequest> => {
    const requestContext = getRequestContext(request);
    const headers = new Headers();

    if (forOptions.userId !== undefined) {
      requestContext.user_id = forOptions.userId ?? undefined;
    } else if (options.getUserId) {
      const userId = await options.getUserId({ request, context: routerContext });
      if (userId) requestContext.user_id = userId;
    }
    if (!requestContext.user_id) delete requestContext.user_id;

    // Always evaluate with a per-visitor anonymous ID, so the shared client's
    // own process-wide ID is never used for anyone.
    if (!requestContext.anonymous_id) {
      requestContext.anonymous_id = newAnonymousId();
      if (options.setAnonymousIdCookie !== false) {
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        // Not HttpOnly: the browser SDK reads it to bucket the visitor the same way.
        headers.append(
          'Set-Cookie',
          `${ANONYMOUS_ID_COOKIE}=${encodeURIComponent(requestContext.anonymous_id)}; Path=/; ` +
            `Max-Age=${ANONYMOUS_ID_MAX_AGE}; SameSite=Lax${secure}`
        );
      }
    }

    return scope(mergeContext(requestContext, forOptions.context), headers);
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
