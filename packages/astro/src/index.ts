/**
 * @savvagent/astro - Astro integration for Savvagent feature flags
 *
 * Provides Astro integration, middleware, and server-side helpers.
 *
 * @packageDocumentation
 */

import type { AstroIntegration, AstroIntegrationLogger, MiddlewareHandler } from 'astro';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import {
  ANONYMOUS_ID_COOKIE,
  anonymousIdCookieOptions,
  buildRequestContext,
  createRequestScope,
  defaultReportError,
  guardReporter,
  isSecureUrl,
  newAnonymousId as newWebCryptoAnonymousId,
  parseCookies,
  throttleErrors,
  toServerConfig,
} from '@savvagent/sdk/server';
import { helperScope as internalHelperScope, localsInternals } from './helper-scope';

// The request scope (cookies, context, user_id rules, bounded evaluation,
// error throttling) is the one shared by every server integration (#26).
export {
  ANONYMOUS_ID_COOKIE,
  USER_ID_COOKIE,
  DEFAULT_EVALUATION_TIMEOUT_MS,
  ERROR_REPORT_INTERVAL_MS,
  toServerConfig,
  throttleErrors,
} from '@savvagent/sdk/server';

let clientInstance: FlagClient | null = null;
/** Defaults and throttled error reporter of {@link clientInstance}, for the request helpers. */
let clientDefaults: Record<string, boolean> | undefined;
let clientReportError: ((error: Error) => void) | undefined;

export interface SavvagentIntegrationOptions {
  /**
   * Savvagent configuration for the server-side client, inlined into the
   * server bundle as JSON. Values are therefore fixed when the config is
   * loaded (at `astro build` for production), and function values such as
   * `onError` are dropped. Prefer {@link configModule} to read environment
   * variables at server runtime or to keep function options.
   */
  config?: FlagClientConfig;
  /**
   * Path (relative to the project root, or absolute) to a module whose
   * default export is the client config, e.g. `'./src/savvagent.config.mjs'`.
   * The middleware imports it at server runtime, so `process.env` is read
   * when the server starts and function options such as `onError` survive.
   * Takes precedence over {@link config}.
   *
   * The module may also export a named `getUserId` function (see
   * {@link GetUserId}); it is the recommended source of `user_id`.
   */
  configModule?: string;
  /**
   * Read `user_id` from the `user_id` cookie. Off by default: the cookie is
   * set by the browser, so any visitor can claim any user ID and receive that
   * user's targeted flags. Enable it only for demos, or when nothing gated by
   * a flag is sensitive. A user returned by `getUserId` takes precedence.
   */
  trustUserIdCookie?: boolean;
  /**
   * Upper bound on one flag evaluation in `Astro.locals.savvagent`, in
   * milliseconds (default: 1000). When the Flags API is slow or down, the
   * evaluation resolves with the flag's default (`reason: 'error'`) instead
   * of holding up the page.
   */
  evaluationTimeoutMs?: number;
}

/** Arguments passed to {@link GetUserId}. */
export interface UserIdArgs {
  request: Request;
  /** `Astro.locals` of the current request, including values set by your own middleware. */
  locals: App.Locals;
}

/**
 * Resolve the authenticated user's ID for a request from your own auth (a
 * session, a verified token, a value your auth middleware put in
 * `Astro.locals`). Called once per request, on its first evaluation, so
 * values your middleware sets after the Savvagent middleware are visible.
 *
 * Functions cannot be inlined into the server bundle, so with the
 * integration export it as `getUserId` from your `configModule`; with
 * {@link createSavvagentMiddleware} pass it in the options.
 */
export type GetUserId = (
  args: UserIdArgs
) => string | null | undefined | Promise<string | null | undefined>;

/** Options for {@link createSavvagentMiddleware}. */
export interface SavvagentMiddlewareOptions {
  /** See {@link SavvagentIntegrationOptions.trustUserIdCookie}. Default: false. */
  trustUserIdCookie?: boolean;
  /** See {@link GetUserId}. Takes precedence over the `user_id` cookie. */
  getUserId?: GetUserId;
  /** See {@link SavvagentIntegrationOptions.evaluationTimeoutMs}. Default: 1000. */
  evaluationTimeoutMs?: number;
}

/**
 * Request-scoped Savvagent API, available as `Astro.locals.savvagent` in
 * pages, endpoints and middleware once the integration is installed.
 *
 * Every method merges the context derived from the current request (the
 * `session_id` and `savvagent_anonymous_id` cookies, `Accept-Language`, and
 * `user_id` from `getUserId` or, only with `trustUserIdCookie`, the
 * `user_id` cookie) with the context you pass; values you pass win.
 * Evaluations are bounded by `evaluationTimeoutMs` and fall back to the
 * flag's default.
 * Visitors without a `savvagent_anonymous_id` cookie get a fresh one, so
 * each visitor keeps a stable rollout bucket. On prerendered pages (Astro 5
 * and later) no request headers or cookies are read.
 */
export interface SavvagentLocals {
  /**
   * The server-side FlagClient. It is shared by every request in the server
   * process: never mutate it per request (`setUserId`, `setOverride`,
   * `setEnvironment`, ...), pass per-request context to the methods below
   * instead. `null` when the client could not be created (invalid config);
   * the methods then return flag defaults.
   */
  client: FlagClient | null;
  /**
   * Context derived from the current request. `user_id` from `getUserId`
   * appears here once the first evaluation of the request has resolved it.
   */
  context: FlagContext;
  isEnabled(flagKey: string, context?: FlagContext): Promise<boolean>;
  evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult>;
  withFlag<T>(
    flagKey: string,
    callback: () => T | Promise<T>,
    context?: FlagContext
  ): Promise<T | null>;
  trackError(flagKey: string, error: Error, context?: FlagContext): void;
}

declare global {
  // Astro's documented way to type `Astro.locals` is to augment `App.Locals`.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    interface Locals {
      savvagent: SavvagentLocals;
    }
  }
}

/** Id of the virtual module that carries the integration config to the middleware. */
export const SAVVAGENT_CONFIG_MODULE_ID = 'virtual:@savvagent/astro/config';
const RESOLVED_CONFIG_MODULE_ID = '\0' + SAVVAGENT_CONFIG_MODULE_ID;

/**
 * Check a client config for problems that would stop the client from
 * being created. Returns human-readable problems (empty when valid).
 */
export function validateConfig(config: unknown): string[] {
  if (!config || typeof config !== 'object') {
    return ['config must be an object with at least an `apiKey`'];
  }
  const { apiKey } = config as Partial<FlagClientConfig>;
  if (!apiKey) return ['`apiKey` is missing'];
  if (typeof apiKey !== 'string' || !apiKey.startsWith('sdk_')) {
    return ['`apiKey` must be an SDK key starting with "sdk_"'];
  }
  return [];
}

/** Keys of a config whose values are functions (lost when serialized as JSON). */
export function functionValuedKeys(config: object): string[] {
  return Object.entries(config)
    .filter(([, value]) => typeof value === 'function')
    .map(([key]) => key);
}

/** Integration options the middleware needs at runtime (JSON-serializable). */
type RuntimeOptions = Pick<SavvagentIntegrationOptions, 'trustUserIdCookie' | 'evaluationTimeoutMs'>;

function savvagentConfigPlugin(
  source: { json: FlagClientConfig } | { modulePath: string; hasGetUserId?: boolean },
  runtimeOptions: RuntimeOptions
) {
  const optionsCode = `export const options = ${JSON.stringify(runtimeOptions)};`;
  let code: string;
  if ('modulePath' in source) {
    const specifier = JSON.stringify(source.modulePath);
    // Re-export getUserId only when the module has it: Vite warns about an
    // import that can never be defined. When that is unknown (the module could
    // not be loaded at startup), read it from the namespace, which tolerates
    // a missing export.
    code =
      source.hasGetUserId === undefined
        ? `import * as configModule from ${specifier};\n` +
          'export default configModule.default;\n' +
          'export const getUserId = configModule.getUserId;\n' +
          optionsCode
        : `export { default${source.hasGetUserId ? ', getUserId' : ''} } from ${specifier};\n` +
          (source.hasGetUserId ? '' : 'export const getUserId = undefined;\n') +
          optionsCode;
  } else {
    code = `export default ${JSON.stringify(source.json)};\nexport const getUserId = undefined;\n` + optionsCode;
  }
  return {
    name: '@savvagent/astro:config',
    resolveId(id: string) {
      return id === SAVVAGENT_CONFIG_MODULE_ID ? RESOLVED_CONFIG_MODULE_ID : undefined;
    },
    load(id: string) {
      return id === RESOLVED_CONFIG_MODULE_ID ? code : undefined;
    },
  };
}

function reportConfigProblems(
  logger: AstroIntegrationLogger,
  problems: string[],
  source: 'config' | 'configModule'
): void {
  for (const problem of problems) {
    if (source === 'configModule') {
      // The module is imported again at server runtime, where its environment may differ.
      logger.warn(
        `Savvagent configModule looks invalid at startup: ${problem}. It is checked again ` +
          `at server runtime; if it is still invalid there, Astro.locals.savvagent returns flag defaults.`
      );
    } else {
      logger.error(
        `Invalid Savvagent config: ${problem}. Astro.locals.savvagent will return flag defaults.`
      );
    }
  }
}

/**
 * Astro integration for Savvagent.
 *
 * Registers middleware that initializes a shared server-side client and
 * provides `Astro.locals.savvagent` (see {@link SavvagentLocals}) on every
 * request, and injects the matching `App.Locals` types.
 *
 * @param options - Integration options
 * @returns Astro integration
 *
 * @example
 * ```ts
 * // astro.config.mjs
 * import { defineConfig } from 'astro/config';
 * import savvagent from '@savvagent/astro';
 *
 * export default defineConfig({
 *   // src/savvagent.config.mjs: export default { apiKey: process.env.SAVVAGENT_FLAGS_API_KEY };
 *   integrations: [savvagent({ configModule: './src/savvagent.config.mjs' })],
 * });
 * ```
 */
export default function savvagent(
  options: SavvagentIntegrationOptions
): AstroIntegration {
  return {
    name: '@savvagent/astro',
    hooks: {
      'astro:config:setup': async ({ addMiddleware, updateConfig, config, logger }) => {
        const runtimeOptions: RuntimeOptions = {
          trustUserIdCookie: options.trustUserIdCookie,
          evaluationTimeoutMs: options.evaluationTimeoutMs,
        };
        if (options.configModule) {
          // Imported lazily so this module stays free of static Node imports
          // (pages and client code may import it too).
          const { isAbsolute, resolve: resolvePath } = await import('node:path');
          const { fileURLToPath, pathToFileURL } = await import('node:url');
          const root = config?.root ? fileURLToPath(config.root) : process.cwd();
          const modulePath = isAbsolute(options.configModule)
            ? options.configModule
            : resolvePath(root, options.configModule);
          // Unknown (undefined) when the module cannot be loaded now.
          let hasGetUserId: boolean | undefined;
          try {
            const loaded = await import(pathToFileURL(modulePath).href);
            hasGetUserId = 'getUserId' in loaded;
            if (hasGetUserId && typeof loaded.getUserId !== 'function') {
              logger.warn('The `getUserId` export of configModule is not a function; it is ignored.');
            }
            reportConfigProblems(logger, validateConfig(loaded.default), 'configModule');
          } catch (error) {
            logger.warn(
              `Could not load configModule "${options.configModule}" to validate it ` +
                `(${(error as Error).message}); it will be loaded at server runtime.`
            );
          }
          // Forward slashes, as Vite's normalizePath does, so Windows paths
          // form a valid import specifier.
          updateConfig({
            vite: {
              plugins: [
                savvagentConfigPlugin({ modulePath: toImportPath(modulePath), hasGetUserId }, runtimeOptions),
              ],
            },
          });
        } else if (options.config) {
          const dropped = functionValuedKeys(options.config);
          if (dropped.length > 0) {
            logger.warn(
              `These config options are functions and cannot be inlined as JSON, so they are ` +
                `ignored: ${dropped.join(', ')}. Use the \`configModule\` option to keep them.`
            );
          }
          if (options.config.apiKey) {
            logger.warn(
              'The inline `config` is written into the server bundle as JSON, `apiKey` included. ' +
                'Use the `configModule` option to read the key from the environment at server ' +
                'runtime instead, and never put a server-only secret in `config`.'
            );
          }
          reportConfigProblems(logger, validateConfig(options.config), 'config');
          updateConfig({
            vite: { plugins: [savvagentConfigPlugin({ json: options.config }, runtimeOptions)] },
          });
        } else {
          reportConfigProblems(logger, validateConfig(undefined), 'config');
          updateConfig({
            vite: { plugins: [savvagentConfigPlugin({ json: {} as FlagClientConfig }, runtimeOptions)] },
          });
        }
        addMiddleware({ entrypoint: '@savvagent/astro/middleware', order: 'pre' });
      },
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({
          filename: 'types.d.ts',
          content: '/// <reference types="@savvagent/astro" />\n',
        });
      },
      'astro:build:done': () => {
        if (clientInstance) {
          clientInstance.close();
          clientInstance = null;
          clientDefaults = undefined;
          clientReportError = undefined;
        }
      },
    },
  };
}

/** Options for {@link createSavvagentLocals}. */
export interface SavvagentLocalsOptions {
  /** Anonymous ID to evaluate with when the request has no anonymous ID cookie. */
  anonymousId?: string;
  /** Prerendered pages have no visitor: skip request headers and cookies. */
  isPrerendered?: boolean;
  /** Defaults returned when `client` is null or an evaluation fails or times out. */
  defaults?: Record<string, boolean>;
  /** Read `user_id` from the `user_id` cookie (default: false). See {@link SavvagentIntegrationOptions.trustUserIdCookie}. */
  trustUserIdCookie?: boolean;
  /** Resolve the user's ID; takes precedence over the cookie. See {@link GetUserId}. */
  getUserId?: GetUserId;
  /** `Astro.locals` of the request, passed to `getUserId`. */
  locals?: App.Locals;
  /** Upper bound on one evaluation in milliseconds (default: 1000). */
  evaluationTimeoutMs?: number;
  /** Receives evaluation timeouts (default: `console.error`). */
  reportError?: (error: Error) => void;
}

/**
 * Build the request-scoped API exposed as `Astro.locals.savvagent`, on the
 * request scope shared by the server integrations (`@savvagent/sdk/server`).
 *
 * `getUserId` is called once, on the first evaluation, and bounded by
 * `evaluationTimeoutMs`. When it returns a non-empty string, that is the
 * user. When it returns nothing, a trusted `user_id` cookie (with
 * `trustUserIdCookie`) is kept. When it throws, rejects or times out, the
 * request is evaluated without any `user_id`, the trusted cookie's included.
 *
 * @param client - The FlagClient to evaluate with, or null to always return defaults
 * @param request - The current request
 * @param options - Anonymous ID, prerendering and defaults
 */
export function createSavvagentLocals(
  client: FlagClient | null,
  request: Request,
  options: SavvagentLocalsOptions = {}
): SavvagentLocals {
  // The user_id cookie is set by the browser, so it identifies no one unless trusted (#23).
  const context: FlagContext = options.isPrerendered
    ? {}
    : buildRequestContext({
        cookies: parseCookies(request.headers.get('cookie')),
        acceptLanguage: request.headers.get('accept-language'),
        trustUserIdCookie: options.trustUserIdCookie,
      });
  if (!context.anonymous_id && options.anonymousId) context.anonymous_id = options.anonymousId;

  // Wrapped once, here: it is also called from timer callbacks (the bounds
  // on getUserId and on each evaluation), where a throw from the app's
  // handler would be an uncaught exception.
  const reportError = guardReporter(options.reportError ?? defaultReportError);
  const getUserId = options.getUserId;
  // Set when getUserId supplied the user, so a user that is still in the
  // context afterwards can only have come from the cookie.
  let userFromGetter = false;
  const scope = createRequestScope({
    client,
    context,
    getUserId:
      typeof getUserId === 'function' && !options.isPrerendered
        ? async () => {
            const userId = await getUserId({ request, locals: options.locals ?? ({} as App.Locals) });
            if (typeof userId === 'string' && userId !== '') userFromGetter = true;
            return userId;
          }
        : undefined,
    evaluationTimeoutMs: options.evaluationTimeoutMs,
    reportError,
    defaults: options.defaults,
  });

  const locals: SavvagentLocals = {
    client,
    context: scope.context,
    isEnabled: scope.isEnabled,
    evaluate: scope.evaluate,
    withFlag: scope.withFlag,
    trackError: scope.trackError,
  };
  localsInternals.set(locals, {
    // The user in the context, settled, and whether it is the cookie's.
    cookieUser: async () => {
      await scope.resolveContext();
      return scope.context.user_id !== undefined && !userFromGetter;
    },
    cookieUserNow: () => scope.context.user_id !== undefined && !userFromGetter,
    // The same request without any `user_id` from the context (an explicit
    // `user_id` in a call's own context still applies).
    withoutUser: () =>
      createRequestScope({
        client,
        context: scope.context,
        userId: null,
        evaluationTimeoutMs: options.evaluationTimeoutMs,
        reportError,
        defaults: options.defaults,
      }),
  });
  return locals;
}

/** Windows-safe import specifier for an absolute file path. */
export function toImportPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * A random anonymous ID, `anon_<uuid>`: the format the browser SDK and the
 * other server integrations use. It comes from Web Crypto
 * (`@savvagent/sdk/server`'s `newAnonymousId`). Node.js 18, which Astro 4
 * and 5 support, has no global Web Crypto without a flag; there the ID
 * comes from `node:crypto`, loaded lazily so edge runtimes never import it.
 */
export async function newAnonymousId(): Promise<string> {
  const webCrypto = globalThis.crypto as { randomUUID?: unknown; getRandomValues?: unknown } | undefined;
  if (webCrypto?.randomUUID || webCrypto?.getRandomValues) return newWebCryptoAnonymousId();
  const { randomUUID } = await import('node:crypto');
  return `anon_${randomUUID()}`;
}

/**
 * Create the middleware that provides `Astro.locals.savvagent`.
 * The integration registers this automatically; use it directly only when
 * composing your own middleware with `sequence()` instead of the integration.
 *
 * @param config - Client configuration (server defaults applied via {@link toServerConfig})
 * @param options - `user_id` source and evaluation bound
 */
export function createSavvagentMiddleware(
  config: FlagClientConfig,
  options: SavvagentMiddlewareOptions = {}
): MiddlewareHandler {
  let client: FlagClient | null = null;
  let failed = false;
  const reportError = throttleErrors(config?.onError ?? defaultReportError);

  return async (context, next) => {
    if (!client && !failed) {
      try {
        client = initSavvagent(toServerConfig({ ...config, onError: reportError }));
      } catch (error) {
        // Report once instead of failing every request with a 500.
        failed = true;
        console.error('[Savvagent] Could not create the server-side client:', error);
      }
    }

    // APIContext.isPrerendered exists since Astro 5. On Astro 4 it is absent,
    // and a prerendered page sees the empty request Astro builds it with.
    const isPrerendered = (context as { isPrerendered?: boolean }).isPrerendered === true;

    let anonymousId: string | undefined;
    if (!isPrerendered && !context.cookies.get(ANONYMOUS_ID_COOKIE)?.value) {
      anonymousId = await newAnonymousId();
      // Not HttpOnly: the browser SDK reads this cookie so client-side
      // evaluations use the same anonymous ID as the server.
      context.cookies.set(ANONYMOUS_ID_COOKIE, anonymousId, anonymousIdCookieOptions(isSecureUrl(context.url)));
    }

    context.locals.savvagent = createSavvagentLocals(client, context.request, {
      anonymousId,
      isPrerendered,
      defaults: config?.defaults,
      trustUserIdCookie: options.trustUserIdCookie,
      getUserId: options.getUserId,
      locals: context.locals,
      evaluationTimeoutMs: options.evaluationTimeoutMs,
      reportError,
    });
    return next();
  };
}

/**
 * Initialize the Savvagent client manually.
 * Use this if not using the Astro integration.
 *
 * @param config - Client configuration
 * @returns The FlagClient instance
 */
export function initSavvagent(config: FlagClientConfig): FlagClient {
  if (!clientInstance) {
    clientInstance = new FlagClient(config);
    clientDefaults = config.defaults;
    clientReportError = throttleErrors(config.onError ?? defaultReportError);
  }
  return clientInstance;
}

/**
 * Get the Savvagent client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getSavvagent(): FlagClient {
  if (!clientInstance) {
    throw new Error(
      'Savvagent client not initialized. Use the integration or call initSavvagent() first.'
    );
  }
  return clientInstance;
}

/** Options for {@link getRequestContext}. */
export interface RequestContextOptions {
  /**
   * Read `user_id` from the `user_id` cookie (default: false). The browser
   * sets that cookie, so any visitor can claim any user ID (#23).
   */
  trustUserIdCookie?: boolean;
}

/**
 * Extract context from Astro request: the `savvagent_anonymous_id` and
 * `session_id` cookies and `Accept-Language`.
 *
 * **Warning:** `user_id` is read from the `user_id` cookie only with
 * `trustUserIdCookie: true`. The browser controls that cookie, so any
 * visitor could claim another user's targeting; enable it only for demos.
 * This function is synchronous and cannot call `getUserId`: pass the
 * authenticated user in `overrides` instead.
 *
 * @param request - Astro Request
 * @param overrides - Additional context properties (win over the request's)
 * @param options - Whether to trust the `user_id` cookie
 * @returns FlagContext
 */
export function getRequestContext(
  request: Request,
  overrides?: FlagContext,
  options: RequestContextOptions = {}
): FlagContext {
  const context = buildRequestContext({
    cookies: parseCookies(request.headers.get('cookie')),
    acceptLanguage: request.headers.get('accept-language'),
    trustUserIdCookie: options.trustUserIdCookie,
  });
  // Overrides replace request values as given, as they always have here.
  return { ...context, ...overrides };
}

/**
 * Check if a feature flag is enabled.
 *
 * @param flagKey - The flag key to evaluate
 * @param context - Optional context for targeting
 * @returns Promise<boolean>
 *
 * @example
 * ```astro
 * ---
 * import { isEnabled } from '@savvagent/astro';
 *
 * const showNewLayout = await isEnabled('new-layout');
 * ---
 *
 * {showNewLayout ? (
 *   <NewLayout />
 * ) : (
 *   <OldLayout />
 * )}
 * ```
 */
export async function isEnabled(
  flagKey: string,
  context?: FlagContext
): Promise<boolean> {
  const client = getSavvagent();
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
 * ```astro
 * ---
 * import { evaluate } from '@savvagent/astro';
 *
 * const result = await evaluate('premium-features');
 * const { value, reason, metadata } = result;
 * ---
 *
 * <div>
 *   <p>Enabled: {value}</p>
 *   <p>Reason: {reason}</p>
 * </div>
 * ```
 */
export async function evaluate(
  flagKey: string,
  context?: FlagContext
): Promise<FlagEvaluationResult> {
  const client = getSavvagent();
  return client.evaluate(flagKey, context);
}

/**
 * Execute code conditionally based on flag value.
 *
 * @param flagKey - The flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param context - Optional context for targeting
 * @returns Promise with callback result or null
 *
 * @example
 * ```astro
 * ---
 * import { withFlag } from '@savvagent/astro';
 *
 * const data = await withFlag('use-new-api', async () => {
 *   return await fetchFromNewAPI();
 * });
 * ---
 *
 * {data ? <NewView data={data} /> : <OldView />}
 * ```
 */
export async function withFlag<T>(
  flagKey: string,
  callback: () => T | Promise<T>,
  context?: FlagContext
): Promise<T | null> {
  const client = getSavvagent();
  return client.withFlag(flagKey, callback, context);
}

/**
 * Track an error with flag context.
 *
 * @param flagKey - The flag key associated with the error
 * @param error - The error that occurred
 * @param context - Optional context
 *
 * @example
 * ```astro
 * ---
 * import { trackError } from '@savvagent/astro';
 *
 * try {
 *   await processData();
 * } catch (error) {
 *   trackError('data-processor', error);
 * }
 * ---
 * ```
 */
export function trackError(
  flagKey: string,
  error: Error,
  context?: FlagContext
): void {
  const client = getSavvagent();
  client.trackError(flagKey, error, context);
}

/**
 * Set the environment for flag evaluation.
 * Useful for dynamically switching environments.
 *
 * @param environment - The environment name (e.g., "development", "staging", "production")
 *
 * @example
 * ```astro
 * ---
 * import { setEnvironment } from '@savvagent/astro';
 *
 * setEnvironment('staging');
 * ---
 * ```
 */
export function setEnvironment(environment: string): void {
  const client = getSavvagent();
  client.setEnvironment(environment);
}

/**
 * Get the current environment.
 *
 * @returns The current environment name
 *
 * @example
 * ```astro
 * ---
 * import { getEnvironment } from '@savvagent/astro';
 *
 * const env = getEnvironment();
 * ---
 * <p>Environment: {env}</p>
 * ```
 */
export function getEnvironment(): string {
  const client = getSavvagent();
  return client.getEnvironment();
}

/**
 * Options for {@link evaluateForRequest} and {@link createFlagMiddleware}:
 * the same `user_id` sources and evaluation bound as `Astro.locals.savvagent`.
 *
 * When the request already has `Astro.locals.savvagent` (the integration or
 * {@link createSavvagentMiddleware} ran first), the helpers evaluate through
 * it: same anonymous ID (also for a first-time visitor), same user, resolved
 * once per request. `trustUserIdCookie`, `getUserId` and
 * `evaluationTimeoutMs` then come from the integration, and these options
 * apply only when there is no `Astro.locals.savvagent`.
 *
 * A helper can narrow trust but never widen it. `trustUserIdCookie: false`
 * on a helper makes that call evaluate without a `user_id` that came from the
 * cookie (a user from the integration's `getUserId`, or a `user_id` passed in
 * the `context` argument, still applies). `trustUserIdCookie: true`, or
 * saying nothing, changes nothing: if the integration does not trust the
 * cookie, a helper cannot enable it. If `locals.savvagent` is not the scope
 * the middleware created (for example a copy of it), narrowing cannot tell
 * where its `user_id` came from, so the helper evaluates with a fresh scope:
 * anonymous, because the integration's `getUserId` is not available to it
 * (only a `getUserId` in the helper's own options, and a `user_id` in the
 * call's `context`, apply). With no initialised client that scope returns
 * defaults instead of throwing. A helper's own `getUserId` and
 * `evaluationTimeoutMs` are ignored when the request has `Astro.locals.savvagent`.
 */
export interface RequestHelperOptions extends SavvagentMiddlewareOptions {
  /** `Astro.locals` of the request: its `savvagent` scope is reused, and it is passed to `getUserId`. */
  locals?: App.Locals;
}

/**
 * The request scope the helpers evaluate with: the request's `Astro.locals.savvagent` when it exists (narrowed when the
 * helper passes `trustUserIdCookie: false`), else a new scope with the same rules (and
 * no anonymous ID cookie of its own). Uses the client without `getSavvagent()`,
 * which throws when the client was never initialised; a scope with no client
 * returns defaults (reason 'error') instead.
 */
function helperScope(request: Request, options: RequestHelperOptions): SavvagentLocals {
  return internalHelperScope(options, () =>
    createSavvagentLocals(clientInstance ?? null, request, {
      defaults: clientDefaults,
      trustUserIdCookie: options.trustUserIdCookie,
      getUserId: options.getUserId,
      locals: options.locals,
      evaluationTimeoutMs: options.evaluationTimeoutMs,
      reportError: clientReportError,
    })
  );
}

/**
 * Helper to evaluate flags with automatic request context extraction.
 *
 * Uses the same rules as `Astro.locals.savvagent`: the evaluation is bounded
 * by `evaluationTimeoutMs` (default 1000) and falls back to the flag's
 * default, and `user_id` comes from `context`, then `getUserId`. Pass
 * `{ locals: Astro.locals }` to evaluate through the request's
 * `Astro.locals.savvagent` (see {@link RequestHelperOptions}).
 *
 * **Warning:** the `user_id` cookie is read only with
 * `trustUserIdCookie: true`. The browser controls that cookie, so any
 * visitor could claim another user's targeting; enable it only for demos.
 *
 * @param request - Astro Request
 * @param flagKey - The flag key to evaluate
 * @param context - Optional additional context (wins over the request's)
 * @param options - `user_id` sources and evaluation bound
 * @returns Promise<boolean>
 *
 * @example
 * ```astro
 * ---
 * import { evaluateForRequest } from '@savvagent/astro';
 *
 * // Evaluates through Astro.locals.savvagent: its anonymous ID and user.
 * const showBeta = await evaluateForRequest(Astro.request, 'beta-ui', undefined, {
 *   locals: Astro.locals,
 * });
 * ---
 *
 * {showBeta ? <BetaUI /> : <StandardUI />}
 * ```
 */
export async function evaluateForRequest(
  request: Request,
  flagKey: string,
  context?: FlagContext,
  options: RequestHelperOptions = {}
): Promise<boolean> {
  return helperScope(request, options).isEnabled(flagKey, context);
}

/**
 * Create Astro middleware for feature flag-based routing.
 *
 * @example
 * ```ts
 * // src/middleware.ts
 * import { sequence } from 'astro/middleware';
 * import { createFlagMiddleware } from '@savvagent/astro';
 *
 * const flagMiddleware = createFlagMiddleware(
 *   {
 *     'maintenance-mode': {
 *       redirect: '/maintenance',
 *     },
 *     'beta-access': {
 *       rewrite: (url) => url.pathname.startsWith('/') ? '/beta' + url.pathname : url.pathname,
 *     },
 *   },
 *   { getUserId: ({ locals }) => locals.user?.id }
 * );
 *
 * export const onRequest = sequence(flagMiddleware);
 * ```
 *
 * Each flag is evaluated through the request's `Astro.locals.savvagent` when
 * the Savvagent middleware ran first (see {@link RequestHelperOptions}), else
 * with the same rules: bounded by `evaluationTimeoutMs` (default 1000,
 * falling back to the flag's default), with `user_id` from the `context`
 * option, then `getUserId`.
 *
 * **Warning:** the `user_id` cookie is read only with
 * `trustUserIdCookie: true`. The browser controls that cookie, so with it
 * any visitor could steer redirects, rewrites and handlers gated on another
 * user's flags; enable it only for demos.
 */
export interface FlagMiddlewareConfig {
  [flagKey: string]: {
    /** Redirect to this path if flag is enabled */
    redirect?: string;
    /** Rewrite URL if flag is enabled */
    rewrite?: (url: URL) => string;
    /** Custom handler if flag is enabled */
    handler?: (context: any) => Promise<Response | void>;
  };
}

/** Options for {@link createFlagMiddleware}. */
export interface FlagMiddlewareOptions extends SavvagentMiddlewareOptions {
  /**
   * Extra context for every evaluation, or a function of the Astro context
   * that returns it (for example `({ locals }) => ({ user_id: locals.user?.id })`).
   * Wins over the request's context and `getUserId`.
   */
  context?: FlagContext | ((context: any) => FlagContext | undefined);
}

export function createFlagMiddleware(
  config: FlagMiddlewareConfig,
  middlewareOptions: FlagMiddlewareOptions = {}
) {
  return async (context: any, next: () => Promise<Response>) => {
    // Reuses context.locals.savvagent when the Savvagent middleware ran first.
    const scope = helperScope(context.request, { ...middlewareOptions, locals: context.locals });
    const extraContext =
      typeof middlewareOptions.context === 'function'
        ? middlewareOptions.context(context)
        : middlewareOptions.context;

    for (const [flagKey, options] of Object.entries(config)) {
      const enabled = await scope.isEnabled(flagKey, extraContext);

      if (enabled) {
        if (options.redirect) {
          return Response.redirect(
            new URL(options.redirect, context.request.url),
            302
          );
        }

        if (options.rewrite) {
          const newPath = options.rewrite(new URL(context.request.url));
          context.url = new URL(newPath, context.request.url);
        }

        if (options.handler) {
          const response = await options.handler(context);
          if (response) return response;
        }
      }
    }

    return next();
  };
}

// Re-export types
export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  EvaluationEvent,
  ErrorEvent,
  FlagUpdateEvent,
  // Generated API types for advanced users
  ApiTypes,
  components,
} from '@savvagent/sdk';

// Re-export FlagClient for advanced use cases
export { FlagClient } from '@savvagent/sdk';
