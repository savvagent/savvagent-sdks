/**
 * @savvagent/astro - Astro integration for Savvagent feature flags
 *
 * Provides Astro integration, middleware, and server-side helpers.
 *
 * @packageDocumentation
 */

import type { AstroIntegration, AstroIntegrationLogger, MiddlewareHandler } from 'astro';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

let clientInstance: FlagClient | null = null;

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
   */
  configModule?: string;
}

/**
 * Request-scoped Savvagent API, available as `Astro.locals.savvagent` in
 * pages, endpoints and middleware once the integration is installed.
 *
 * Every method merges the context derived from the current request (the
 * `user_id`, `session_id` and `savvagent_anonymous_id` cookies and
 * `Accept-Language`) with the context you pass; values you pass win.
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
  /** Context derived from the current request. */
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

/** Cookie that keeps a visitor's anonymous ID stable across requests. */
export const ANONYMOUS_ID_COOKIE = 'savvagent_anonymous_id';
const ANONYMOUS_ID_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Apply server-side defaults to a client config. Realtime (SSE) updates rely
 * on browser globals, so they are off unless explicitly enabled.
 */
export function toServerConfig(config: FlagClientConfig): FlagClientConfig {
  return { ...config, enableRealtime: config.enableRealtime ?? false };
}

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

function savvagentConfigPlugin(source: { json: FlagClientConfig } | { modulePath: string }) {
  const code =
    'modulePath' in source
      ? `export { default } from ${JSON.stringify(source.modulePath)};`
      : `export default ${JSON.stringify(source.json)};`;
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
 *   // src/savvagent.config.mjs: export default { apiKey: process.env.SAVVAGENT_SDK_KEY };
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
        if (options.configModule) {
          // Imported lazily so this module stays free of static Node imports
          // (pages and client code may import it too).
          const { isAbsolute, resolve: resolvePath } = await import('node:path');
          const { fileURLToPath, pathToFileURL } = await import('node:url');
          const root = config?.root ? fileURLToPath(config.root) : process.cwd();
          const modulePath = isAbsolute(options.configModule)
            ? options.configModule
            : resolvePath(root, options.configModule);
          // Forward slashes, as Vite's normalizePath does, so Windows paths
          // form a valid import specifier.
          updateConfig({
            vite: { plugins: [savvagentConfigPlugin({ modulePath: toImportPath(modulePath) })] },
          });
          try {
            const loaded = await import(pathToFileURL(modulePath).href);
            reportConfigProblems(logger, validateConfig(loaded.default), 'configModule');
          } catch (error) {
            logger.warn(
              `Could not load configModule "${options.configModule}" to validate it ` +
                `(${(error as Error).message}); it will be loaded at server runtime.`
            );
          }
        } else if (options.config) {
          const dropped = functionValuedKeys(options.config);
          if (dropped.length > 0) {
            logger.warn(
              `These config options are functions and cannot be inlined as JSON, so they are ` +
                `ignored: ${dropped.join(', ')}. Use the \`configModule\` option to keep them.`
            );
          }
          reportConfigProblems(logger, validateConfig(options.config), 'config');
          updateConfig({ vite: { plugins: [savvagentConfigPlugin({ json: options.config })] } });
        } else {
          reportConfigProblems(logger, validateConfig(undefined), 'config');
          updateConfig({ vite: { plugins: [savvagentConfigPlugin({ json: {} as FlagClientConfig })] } });
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
  /** Defaults returned when `client` is null. */
  defaults?: Record<string, boolean>;
}

/**
 * Build the request-scoped API exposed as `Astro.locals.savvagent`.
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
  const fromRequest = options.isPrerendered ? {} : getRequestContext(request);
  const requestContext = Object.fromEntries(
    Object.entries({ ...fromRequest, anonymous_id: fromRequest.anonymous_id || options.anonymousId }).filter(
      ([key, value]) => key !== '' && value !== undefined && value !== ''
    )
  ) as FlagContext;

  const merge = (context?: FlagContext): FlagContext => ({ ...requestContext, ...context });

  if (!client) {
    const defaultFor = (flagKey: string) => options.defaults?.[flagKey] ?? false;
    return {
      client: null,
      context: requestContext,
      isEnabled: async (flagKey) => defaultFor(flagKey),
      evaluate: async (flagKey) => ({ key: flagKey, value: defaultFor(flagKey), reason: 'error' }),
      withFlag: async (flagKey, callback) => (defaultFor(flagKey) ? callback() : null),
      trackError: () => {},
    };
  }

  return {
    client,
    context: requestContext,
    isEnabled: (flagKey, context) => client.isEnabled(flagKey, merge(context)),
    evaluate: (flagKey, context) => client.evaluate(flagKey, merge(context)),
    withFlag: (flagKey, callback, context) => client.withFlag(flagKey, callback, merge(context)),
    trackError: (flagKey, error, context) => client.trackError(flagKey, error, merge(context)),
  };
}

/** Windows-safe import specifier for an absolute file path. */
export function toImportPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

type CryptoLike = { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView>(a: T) => T };

/**
 * A random anonymous ID from a cryptographic source: Web Crypto when
 * available, else node:crypto (loaded lazily, e.g. on Node 18).
 */
export async function newAnonymousId(): Promise<string> {
  let source = globalThis.crypto as CryptoLike | undefined;
  if (!source?.randomUUID && !source?.getRandomValues) {
    source = (await import('node:crypto')) as CryptoLike;
  }
  if (source.randomUUID) return source.randomUUID();
  const bytes = source.getRandomValues!(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create the middleware that provides `Astro.locals.savvagent`.
 * The integration registers this automatically; use it directly only when
 * composing your own middleware with `sequence()` instead of the integration.
 *
 * @param config - Client configuration (server defaults applied via {@link toServerConfig})
 */
export function createSavvagentMiddleware(config: FlagClientConfig): MiddlewareHandler {
  let client: FlagClient | null = null;
  let failed = false;

  return async (context, next) => {
    if (!client && !failed) {
      try {
        client = initSavvagent(toServerConfig(config));
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
      context.cookies.set(ANONYMOUS_ID_COOKIE, anonymousId, {
        path: '/',
        sameSite: 'lax',
        secure: context.url?.protocol === 'https:',
        httpOnly: false,
        maxAge: ANONYMOUS_ID_MAX_AGE,
      });
    }

    context.locals.savvagent = createSavvagentLocals(client, context.request, {
      anonymousId,
      isPrerendered,
      defaults: config?.defaults,
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

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extract context from Astro request.
 *
 * @param request - Astro Request
 * @param overrides - Additional context properties
 * @returns FlagContext
 */
export function getRequestContext(
  request: Request,
  overrides?: FlagContext
): FlagContext {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((c) => {
      const [key, ...values] = c.split('=');
      return [key, decodeCookieValue(values.join('='))];
    })
  );

  const context: FlagContext = {
    user_id: cookies.user_id,
    anonymous_id: cookies.savvagent_anonymous_id,
    session_id: cookies.session_id,
    language: request.headers.get('accept-language')?.split(',')[0] || undefined,
    ...overrides,
  };

  return context;
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
 * Helper to evaluate flags with automatic request context extraction.
 *
 * @param request - Astro Request
 * @param flagKey - The flag key to evaluate
 * @param context - Optional additional context
 * @returns Promise<boolean>
 *
 * @example
 * ```astro
 * ---
 * import { evaluateForRequest } from '@savvagent/astro';
 *
 * const showBeta = await evaluateForRequest(Astro.request, 'beta-ui');
 * ---
 *
 * {showBeta ? <BetaUI /> : <StandardUI />}
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
 * Create Astro middleware for feature flag-based routing.
 *
 * @example
 * ```ts
 * // src/middleware.ts
 * import { sequence } from 'astro/middleware';
 * import { createFlagMiddleware } from '@savvagent/astro';
 *
 * const flagMiddleware = createFlagMiddleware({
 *   'maintenance-mode': {
 *     redirect: '/maintenance',
 *   },
 *   'beta-access': {
 *     rewrite: (url) => url.pathname.startsWith('/') ? '/beta' + url.pathname : url.pathname,
 *   },
 * });
 *
 * export const onRequest = sequence(flagMiddleware);
 * ```
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

export function createFlagMiddleware(config: FlagMiddlewareConfig) {
  return async (context: any, next: () => Promise<Response>) => {
    const client = getSavvagent();
    const requestContext = getRequestContext(context.request);

    for (const [flagKey, options] of Object.entries(config)) {
      const enabled = await client.isEnabled(flagKey, requestContext);

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
