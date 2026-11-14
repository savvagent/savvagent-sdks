/**
 * @savvagent/astro - Astro integration for Savvagent feature flags
 *
 * Provides Astro integration, middleware, and server-side helpers.
 *
 * @packageDocumentation
 */

import type { AstroIntegration, MiddlewareHandler } from 'astro';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

let clientInstance: FlagClient | null = null;

export interface SavvagentIntegrationOptions {
  /**
   * Savvagent configuration for the server-side client.
   *
   * The integration serializes this object as JSON into the server bundle so
   * the middleware can build the client at request time. Function values
   * (such as `onError`) are therefore not carried over; call
   * `initSavvagent()` yourself from your own middleware if you need them.
   */
  config: FlagClientConfig;
}

/**
 * Request-scoped Savvagent API, available as `Astro.locals.savvagent` in
 * pages, endpoints and middleware once the integration is installed.
 *
 * Every method merges the context derived from the current request (cookies
 * and `Accept-Language`, see {@link getRequestContext}) with the context you
 * pass; values you pass win.
 */
export interface SavvagentLocals {
  /** The shared server-side FlagClient. */
  client: FlagClient;
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

/**
 * Apply server-side defaults to a client config. Realtime (SSE) updates rely
 * on browser globals, so they are off unless explicitly enabled.
 */
export function toServerConfig(config: FlagClientConfig): FlagClientConfig {
  return { ...config, enableRealtime: config.enableRealtime ?? false };
}

function savvagentConfigPlugin(config: FlagClientConfig) {
  return {
    name: '@savvagent/astro:config',
    resolveId(id: string) {
      return id === SAVVAGENT_CONFIG_MODULE_ID ? RESOLVED_CONFIG_MODULE_ID : undefined;
    },
    load(id: string) {
      return id === RESOLVED_CONFIG_MODULE_ID
        ? `export default ${JSON.stringify(config)};`
        : undefined;
    },
  };
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
 *   integrations: [
 *     savvagent({
 *       config: {
 *         apiKey: process.env.SAVVAGENT_SDK_KEY,
 *         applicationId: process.env.SAVVAGENT_APP_ID,
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export default function savvagent(
  options: SavvagentIntegrationOptions
): AstroIntegration {
  return {
    name: '@savvagent/astro',
    hooks: {
      'astro:config:setup': ({ addMiddleware, updateConfig }) => {
        updateConfig({
          vite: { plugins: [savvagentConfigPlugin(options.config)] },
        });
        addMiddleware({ entrypoint: '@savvagent/astro/middleware', order: 'pre' });
      },
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({
          filename: 'types.d.ts',
          content: '/// <reference types="@savvagent/astro" />\n',
        });
      },
      'astro:build:done': () => {
        // Prerendering runs the middleware in the build process; release its client.
        if (clientInstance) {
          clientInstance.close();
          clientInstance = null;
        }
      },
    },
  };
}

/**
 * Build the request-scoped API exposed as `Astro.locals.savvagent`.
 *
 * @param client - The FlagClient to evaluate with
 * @param request - The current request
 */
export function createSavvagentLocals(client: FlagClient, request: Request): SavvagentLocals {
  const requestContext = Object.fromEntries(
    Object.entries(getRequestContext(request)).filter(
      ([key, value]) => key !== '' && value !== undefined && value !== ''
    )
  ) as FlagContext;

  const merge = (context?: FlagContext): FlagContext => ({ ...requestContext, ...context });

  return {
    client,
    context: requestContext,
    isEnabled: (flagKey, context) => client.isEnabled(flagKey, merge(context)),
    evaluate: (flagKey, context) => client.evaluate(flagKey, merge(context)),
    withFlag: (flagKey, callback, context) => client.withFlag(flagKey, callback, merge(context)),
    trackError: (flagKey, error, context) => client.trackError(flagKey, error, merge(context)),
  };
}

/**
 * Create the middleware that provides `Astro.locals.savvagent`.
 * The integration registers this automatically; use it directly only when
 * composing your own middleware with `sequence()` instead of the integration.
 *
 * @param config - Client configuration (server defaults applied via {@link toServerConfig})
 */
export function createSavvagentMiddleware(config: FlagClientConfig): MiddlewareHandler {
  return (context, next) => {
    const client = initSavvagent(toServerConfig(config));
    context.locals.savvagent = createSavvagentLocals(client, context.request);
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
      return [key, values.join('=')];
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
