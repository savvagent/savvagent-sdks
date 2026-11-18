/**
 * Server-side client defaults, error throttling and time-bounded evaluation.
 */

import type { FlagClientConfig, FlagContext, FlagEvaluationResult } from '../types';
import { defaultFor } from '../flags';

/** Default bound on one server-side evaluation (and on `getUserId`), in milliseconds. */
export const DEFAULT_EVALUATION_TIMEOUT_MS = 1000;
/** Window in which the same error message is reported to `onError` only once. */
export const ERROR_REPORT_INTERVAL_MS = 60_000;
/** Distinct messages {@link throttleErrors} remembers at once. */
const MAX_THROTTLED_MESSAGES = 100;

/**
 * The parts of a `FlagClient` the request scope uses. Structural, so any
 * `FlagClient` (or a test double) fits.
 */
export interface EvaluatingClient {
  evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult>;
  trackError(flagKey: string, error: Error, context?: FlagContext): void;
}

/**
 * Apply server-side defaults to a client config: no realtime (SSE)
 * connection, no language detection from the server's own locale, and a
 * single attempt per evaluation (no retries while a page waits). Values the
 * config sets explicitly are kept.
 */
export function toServerConfig(config: FlagClientConfig): FlagClientConfig {
  return {
    ...config,
    enableRealtime: config.enableRealtime ?? false,
    disableLanguageDetection: config.disableLanguageDetection ?? true,
    retryAttempts: config.retryAttempts ?? 1,
  };
}

/** The error reporter used when the config has no `onError`. */
export function defaultReportError(error: Error): void {
  console.error('[Savvagent]', error);
}

/**
 * Wrap an error handler so that a throw from it is logged instead of
 * propagating. Reporters run inside timer callbacks, where a throw would be
 * an uncaught exception and could stop the process.
 */
export function guardReporter(onError: (error: Error) => void): (error: Error) => void {
  return (error: Error) => {
    try {
      onError(error);
    } catch (handlerError) {
      console.error('[Savvagent] onError handler threw', handlerError);
    }
  };
}

/**
 * Wrap an error handler so the same error message is reported at most once
 * per `intervalMs` (default: once a minute), tracking at most 100 distinct
 * messages. When the Flags API is down, every request fails the same way;
 * this keeps the logs readable. A throw from `onError` is logged, never
 * propagated.
 */
export function throttleErrors(
  onError: (error: Error) => void,
  intervalMs: number = ERROR_REPORT_INTERVAL_MS
): (error: Error) => void {
  const lastReported = new Map<string, number>();
  const report = guardReporter(onError);
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
    report(error);
  };
}

/**
 * Settle with `work`, or with `onTimeout()` after `ms` milliseconds,
 * whichever comes first. The timer is always cleared. A rejection of `work`
 * after the timeout is handled (ignored), never unhandled.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The result returned when a flag cannot be evaluated: its default, with
 * `reason: 'error'`. With `{ timestamp: true }` it also carries
 * `metadata.timestamp` (the time of the failure, in epoch milliseconds).
 */
export function fallbackResult(
  flagKey: string,
  defaults: Record<string, boolean> | undefined,
  options?: { timestamp?: boolean }
): FlagEvaluationResult {
  const result: FlagEvaluationResult = { key: flagKey, value: defaultFor(defaults, flagKey), reason: 'error' };
  if (options?.timestamp) result.metadata = { timestamp: Date.now() };
  return result;
}

/** Options for {@link evaluateBounded}. */
export interface BoundedEvaluationOptions {
  /** Upper bound on the evaluation, in milliseconds (default: {@link DEFAULT_EVALUATION_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Receives the timeout or evaluation error (default: `console.error`). A throw from it is logged. */
  reportError?: (error: Error) => void;
  /** Flag defaults for the fallback result, usually the client config's `defaults`. */
  defaults?: Record<string, boolean>;
  /**
   * Build the fallback result. Default: {@link fallbackResult}, i.e.
   * `{ key, value: <default>, reason: 'error' }`.
   */
  fallback?: (flagKey: string) => FlagEvaluationResult;
  /** Also called with the timeout or evaluation error, after `reportError`. */
  onFailure?: (error: Error) => void;
}

/**
 * Evaluate a flag with one bounded attempt. Resolves with the fallback (the
 * flag's default, `reason: 'error'`) if `client` is null, if evaluation
 * throws or rejects, or if it has not answered within the timeout. Never
 * rejects.
 */
export async function evaluateBounded(
  client: EvaluatingClient | null,
  flagKey: string,
  context: FlagContext | undefined,
  options: BoundedEvaluationOptions = {}
): Promise<FlagEvaluationResult> {
  const makeFallback = options.fallback ?? ((key: string) => fallbackResult(key, options.defaults));
  if (!client) return makeFallback(flagKey);
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS;
  const report = guardReporter(options.reportError ?? defaultReportError);
  const fail = (error: Error): FlagEvaluationResult => {
    report(error);
    if (options.onFailure) guardReporter(options.onFailure)(error);
    return makeFallback(flagKey);
  };
  try {
    return await withTimeout(client.evaluate(flagKey, context), timeoutMs, () =>
      fail(new Error(`Flag evaluation (${flagKey}) timed out after ${timeoutMs}ms`))
    );
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * A client created with server defaults, plus what bounded evaluation
 * needs: its config's `defaults`, a throttled error reporter and the
 * evaluation timeout.
 */
export interface ServerClient<C extends EvaluatingClient = EvaluatingClient> {
  client: C;
  /** The config as given (before {@link toServerConfig}). */
  config: FlagClientConfig;
  /** The config's `onError` (or `console.error`), throttled by {@link throttleErrors}. */
  reportError: (error: Error) => void;
  /** Bound on one evaluation, in milliseconds. */
  timeoutMs: number;
}

/**
 * Create a client with {@link toServerConfig} defaults and a throttled
 * `onError`. The constructor is passed in, so this module carries no copy
 * of `FlagClient` and callers (and their tests) control which one is used.
 * A throw from the constructor propagates.
 */
export function createServerClient<C extends EvaluatingClient>(
  ClientCtor: new (config: FlagClientConfig) => C,
  config: FlagClientConfig,
  options: { evaluationTimeoutMs?: number } = {}
): ServerClient<C> {
  const reportError = throttleErrors(config.onError ?? defaultReportError);
  return {
    client: new ClientCtor(toServerConfig({ ...config, onError: reportError })),
    config,
    reportError,
    timeoutMs: options.evaluationTimeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS,
  };
}
