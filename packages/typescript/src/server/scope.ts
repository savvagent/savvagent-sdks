/**
 * The request scope: flag evaluation for one server request, with the
 * request's context, its user resolved once, and every evaluation bounded.
 */

import type { FlagContext, FlagEvaluationResult } from '../types';
import { mergeContext, resolveUserId } from './context';
import {
  DEFAULT_EVALUATION_TIMEOUT_MS,
  EvaluatingClient,
  defaultReportError,
  evaluateBounded,
  fallbackResult,
  guardReporter,
} from './evaluate';

/** Options for {@link createRequestScope}. */
export interface RequestScopeOptions {
  /**
   * The client to evaluate with, shared by every request. `null` when it
   * could not be created: every evaluation then returns the flag's default
   * (`reason: 'error'`) and `trackError` does nothing.
   */
  client: EvaluatingClient | null;
  /** The request's context, usually from {@link buildRequestContext}. */
  context?: FlagContext;
  /**
   * The authenticated user's ID, when the caller knows it. Any value other
   * than `undefined` is explicit: `getUserId` is not called, and a trusted
   * `user_id` cookie in `context` is dropped. A non-empty string becomes
   * `user_id`; `null` or `''` means "no user", so the request is evaluated
   * without any `user_id`. `undefined` means "not given".
   */
  userId?: string | null;
  /**
   * Resolve the user's ID from the app's own auth, bound to this request.
   * Called at most once, on the first evaluation, and bounded by
   * `evaluationTimeoutMs`. A non-empty string becomes `user_id`; any other
   * result keeps the context's `user_id` (a trusted cookie's). A throw,
   * rejection or timeout is reported and the request continues without a
   * `user_id`, the least privileged identity.
   */
  getUserId?: () => unknown;
  /** Upper bound on one evaluation and on `getUserId`, in milliseconds (default: 1000). */
  evaluationTimeoutMs?: number;
  /**
   * Receives timeouts and failures (default: `console.error`). Wrap it with
   * {@link throttleErrors} to report each message once a minute. A throw
   * from it is logged, never propagated.
   */
  reportError?: (error: Error) => void;
  /** Flag defaults for failed evaluations, usually the client config's `defaults`. */
  defaults?: Record<string, boolean>;
  /** Build the result of a failed evaluation (default: {@link fallbackResult}). */
  fallback?: (flagKey: string) => FlagEvaluationResult;
}

/**
 * Flag evaluation scoped to one request. Every method merges the request's
 * context with the context you pass; values you pass win, except that
 * undefined, null and '' are ignored in that merge. So an empty `user_id`
 * passed to a method does not clear the request's user: to evaluate with no
 * user, pass `userId: null` (or `''`) to {@link createRequestScope}, which
 * skips `getUserId` and drops a trusted cookie.
 */
export interface RequestScope {
  /** The client evaluations go to, or null (see {@link RequestScopeOptions.client}). */
  readonly client: EvaluatingClient | null;
  /**
   * The request's context. `user_id` from `getUserId` appears here once the
   * first evaluation has resolved it.
   */
  readonly context: FlagContext;
  /** Resolve the user (once) and return the request's context merged with `context`. */
  resolveContext(context?: FlagContext): Promise<FlagContext>;
  /** Bounded evaluation; never rejects. */
  evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult>;
  isEnabled(flagKey: string, context?: FlagContext): Promise<boolean>;
  /** Evaluate several flags in parallel, keyed by flag key. */
  evaluateFlags(flagKeys: string[], context?: FlagContext): Promise<Record<string, FlagEvaluationResult>>;
  /**
   * Run `callback` only when the flag is enabled. An error from the callback
   * is tracked against the flag, then re-thrown.
   */
  withFlag<T>(flagKey: string, callback: () => T | Promise<T>, context?: FlagContext): Promise<T | null>;
  /** Track an error against a flag, with the user already resolved for this request (if any). */
  trackError(flagKey: string, error: Error, context?: FlagContext): void;
}

/**
 * Create the request scope the server integrations share.
 *
 * @example
 * ```ts
 * const context = buildRequestContext({
 *   cookies: parseCookies(request.headers.get('cookie')),
 *   acceptLanguage: request.headers.get('accept-language'),
 * });
 * const { anonymousId, isNew } = assignAnonymousId(context);
 * const scope = createRequestScope({ client, context, getUserId: () => getUserId(request) });
 * const enabled = await scope.isEnabled('new-checkout');
 * if (isNew) headers.append('Set-Cookie', serializeAnonymousIdCookie(anonymousId, { secure }));
 * ```
 */
export function createRequestScope(options: RequestScopeOptions): RequestScope {
  const { client } = options;
  const requestContext: FlagContext = { ...options.context };
  const timeoutMs = options.evaluationTimeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS;
  // Wrapped once: the reporter also runs from timer callbacks.
  const reportError = guardReporter(options.reportError ?? defaultReportError);
  const fallback = options.fallback ?? ((flagKey: string) => fallbackResult(flagKey, options.defaults));

  let userResolved: Promise<void> | undefined;
  if (options.userId !== undefined) {
    if (options.userId) requestContext.user_id = options.userId;
    else delete requestContext.user_id;
    userResolved = Promise.resolve();
  }
  const resolveUser = (): Promise<void> => {
    userResolved ??= (async () => {
      const result = await resolveUserId(options.getUserId, { timeoutMs, reportError });
      if (result.userId) requestContext.user_id = result.userId;
      else if (result.failed) delete requestContext.user_id;
    })();
    return userResolved;
  };

  const resolveContext = async (context?: FlagContext): Promise<FlagContext> => {
    // No user lookup without a client: the result would be the default anyway.
    if (client) await resolveUser();
    return mergeContext(requestContext, context);
  };

  const evaluate = async (flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> => {
    if (!client) return fallback(flagKey);
    return evaluateBounded(client, flagKey, await resolveContext(context), {
      timeoutMs,
      reportError,
      fallback,
    });
  };

  const trackError = (flagKey: string, error: Error, context?: FlagContext): void => {
    client?.trackError(flagKey, error, mergeContext(requestContext, context));
  };

  return {
    client,
    context: requestContext,
    resolveContext,
    evaluate,
    isEnabled: async (flagKey, context) => (await evaluate(flagKey, context)).value,
    evaluateFlags: async (flagKeys, context) => {
      const results = await Promise.all(flagKeys.map((flagKey) => evaluate(flagKey, context)));
      return Object.fromEntries(results.map((result, i) => [flagKeys[i], result]));
    },
    withFlag: async (flagKey, callback, context) => {
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
}
