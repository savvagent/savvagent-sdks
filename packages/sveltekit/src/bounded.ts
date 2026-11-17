/**
 * Server-side defaults and bounded evaluation. The same file is in
 * `@savvagent/nextjs`; both follow `@savvagent/react-router` and
 * `@savvagent/astro` (consolidation is tracked in #26).
 *
 * @internal
 */

import type { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

/** Default bound on one server-side evaluation, in milliseconds. */
export const DEFAULT_EVALUATION_TIMEOUT_MS = 1000;
/** Window in which the same error message is reported to `onError` only once. */
export const ERROR_REPORT_INTERVAL_MS = 60_000;

const MAX_THROTTLED_MESSAGES = 100;

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
      // Messages can carry dynamic text (URLs, IDs): drop the oldest entries
      // rather than letting the map grow during an outage.
      while (lastReported.size >= MAX_THROTTLED_MESSAGES) {
        lastReported.delete(lastReported.keys().next().value as string);
      }
    }
    lastReported.delete(key);
    lastReported.set(key, now);
    // The handler also runs inside timer callbacks, where a throw would be an
    // uncaught exception.
    try {
      onError(error);
    } catch (handlerError) {
      console.error('[Savvagent] onError handler threw', handlerError);
    }
  };
}

/** A FlagClient plus the error reporter and timeout its evaluations use. */
export interface BoundedClient {
  client: FlagClient;
  config: FlagClientConfig;
  reportError: (error: Error) => void;
  timeoutMs: number;
}

/**
 * Create a FlagClient with server defaults and a throttled `onError`.
 * The constructor is passed in so each entry uses its own import (and tests
 * can mock it).
 */
export function createBoundedClient(
  FlagClientCtor: new (config: FlagClientConfig) => FlagClient,
  config: FlagClientConfig,
  evaluationTimeoutMs: number | undefined
): BoundedClient {
  const reportError = throttleErrors(config.onError ?? ((error) => console.error('[Savvagent]', error)));
  return {
    client: new FlagClientCtor(toServerConfig({ ...config, onError: reportError })),
    config,
    reportError,
    timeoutMs: evaluationTimeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS,
  };
}

/** The flag's configured default, read as an own property only. */
function defaultFor(config: FlagClientConfig, flagKey: string): boolean {
  const defaults = config.defaults;
  return !!defaults && Object.prototype.hasOwnProperty.call(defaults, flagKey) && defaults[flagKey] === true;
}

/**
 * Evaluate a flag, resolving with the flag's default (`reason: 'error'`)
 * if the Flags API has not answered within the timeout, or if evaluation
 * throws. Never rejects. `onFailure`, if given, receives the timeout or
 * evaluation error.
 */
export async function boundedEvaluate(
  bounded: BoundedClient,
  flagKey: string,
  context?: FlagContext,
  onFailure?: (error: Error) => void
): Promise<FlagEvaluationResult> {
  const fail = (error: Error): FlagEvaluationResult => {
    bounded.reportError(error);
    onFailure?.(error);
    return {
      key: flagKey,
      value: defaultFor(bounded.config, flagKey),
      reason: 'error',
      metadata: { timestamp: Date.now() },
    };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<FlagEvaluationResult>((resolve) => {
    timer = setTimeout(() => {
      resolve(fail(new Error(`Flag evaluation (${flagKey}) timed out after ${bounded.timeoutMs}ms`)));
    }, bounded.timeoutMs);
  });
  try {
    return await Promise.race([bounded.client.evaluate(flagKey, context), timedOut]);
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `callback` only if the flag is enabled (bounded evaluation). Errors
 * from the callback are tracked against the flag, then re-thrown.
 */
export async function boundedWithFlag<T>(
  bounded: BoundedClient,
  flagKey: string,
  callback: () => T | Promise<T>,
  context?: FlagContext
): Promise<T | null> {
  if (!(await boundedEvaluate(bounded, flagKey, context)).value) return null;
  try {
    return await callback();
  } catch (error) {
    bounded.client.trackError(flagKey, error as Error, context);
    throw error;
  }
}

/**
 * Resolve the user ID from an app-supplied `getUserId`. A throw or
 * rejection is reported and treated as "no user", so evaluation proceeds.
 */
export async function resolveUserId(
  getUserId: (() => unknown) | undefined,
  reportError: (error: Error) => void
): Promise<string | undefined> {
  if (!getUserId) return undefined;
  try {
    const userId = await getUserId();
    return typeof userId === 'string' && userId !== '' ? userId : undefined;
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
    return undefined;
  }
}
