/**
 * Building the evaluation context of one server request, and resolving the
 * authenticated user.
 */

import type { FlagContext } from '../types';
import { ANONYMOUS_ID_COOKIE, SESSION_ID_COOKIE, USER_ID_COOKIE, newAnonymousId } from './cookies';
import { DEFAULT_EVALUATION_TIMEOUT_MS, defaultReportError, guardReporter, withTimeout } from './evaluate';

/**
 * The primary language tag of an `Accept-Language` header: the first entry,
 * without its `q` weight (`'de-DE,de;q=0.9'` gives `'de-DE'`). Undefined
 * when the header is missing or empty.
 */
export function parseLanguage(acceptLanguage: string | null | undefined): string | undefined {
  return acceptLanguage?.split(',')[0]?.split(';')[0]?.trim() || undefined;
}

/** Copy of `context` without keys whose value is undefined, null or '', so they never override. */
export function compactContext(context: FlagContext): FlagContext {
  return Object.fromEntries(
    Object.entries(context).filter(
      ([key, value]) => key !== '' && value !== undefined && value !== null && value !== ''
    )
  ) as FlagContext;
}

/**
 * Merge `extra` over `base`. Keys of `extra` that are undefined, null or ''
 * do not override; `attributes` are merged one level deep.
 */
export function mergeContext(base: FlagContext, extra?: FlagContext): FlagContext {
  if (!extra) return { ...base };
  const merged: FlagContext = { ...base, ...compactContext(extra) };
  if (base.attributes || extra.attributes) {
    merged.attributes = { ...base.attributes, ...extra.attributes };
  }
  return merged;
}

/** Where {@link buildRequestContext} reads a request's cookies and language from. */
export interface RequestContextInput {
  /**
   * The request's cookies: a name/value map (for example from
   * {@link parseCookies}) or a getter such as SvelteKit's `cookies.get`. A
   * getter is only asked for the cookies the context uses, and for
   * `user_id` only when `trustUserIdCookie` is set.
   */
  cookies: Record<string, string | undefined> | ((name: string) => string | null | undefined);
  /** The `Accept-Language` header. */
  acceptLanguage?: string | null;
  /**
   * Read `user_id` from the `user_id` cookie. Off by default: the browser
   * sets that cookie, so any visitor can claim any user ID and receive that
   * user's targeted flags. Enable it only for demos.
   */
  trustUserIdCookie?: boolean;
  /** App-wide context under the request's values, such as `environment`. */
  defaultContext?: FlagContext;
}

/**
 * The evaluation context of a request: `anonymous_id` and `session_id` from
 * their cookies, `language` from `Accept-Language`, and `user_id` from the
 * `user_id` cookie only when `trustUserIdCookie` is set. `overrides` win
 * (their undefined, null or '' values do not override). Keys without a
 * value are left out.
 *
 * It does not call `getUserId` (see {@link createRequestScope}) and does not
 * assign an anonymous ID (see {@link assignAnonymousId}).
 */
export function buildRequestContext(input: RequestContextInput, overrides?: FlagContext): FlagContext {
  const source = input.cookies;
  const cookie = (name: string): string | undefined => {
    let value: string | null | undefined;
    if (typeof source === 'function') value = source(name);
    else if (Object.prototype.hasOwnProperty.call(source, name)) value = source[name];
    return typeof value === 'string' ? value : undefined;
  };
  const fromRequest = compactContext({
    user_id: input.trustUserIdCookie ? cookie(USER_ID_COOKIE) : undefined,
    anonymous_id: cookie(ANONYMOUS_ID_COOKIE),
    session_id: cookie(SESSION_ID_COOKIE),
    language: parseLanguage(input.acceptLanguage),
  });
  return mergeContext(mergeContext(compactContext(input.defaultContext ?? {}), fromRequest), overrides);
}

/**
 * Give `context` an anonymous ID if it has none, so the visitor is never
 * bucketed under the shared client's process-wide ID. Returns the context's
 * anonymous ID and whether it is new; when it is, the integration should
 * store it in the visitor's cookie (see {@link serializeAnonymousIdCookie}).
 * Mutates `context`.
 */
export function assignAnonymousId(context: FlagContext): { anonymousId: string; isNew: boolean } {
  if (context.anonymous_id) return { anonymousId: context.anonymous_id, isNew: false };
  context.anonymous_id = newAnonymousId();
  return { anonymousId: context.anonymous_id, isNew: true };
}

/** Outcome of {@link resolveUserId}. */
export interface UserIdResult {
  /** The user's ID, when `getUserId` returned a non-empty string. */
  userId?: string;
  /**
   * True when `getUserId` threw, rejected or timed out. The request should
   * then be evaluated without any `user_id`, including a trusted cookie's:
   * once `getUserId` is configured it is the authority on who the user is.
   */
  failed: boolean;
}

/** Options for {@link resolveUserId}. */
export interface ResolveUserIdOptions {
  /** Upper bound on `getUserId`, in milliseconds (default: {@link DEFAULT_EVALUATION_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Receives the failure (default: `console.error`). A throw from it is logged. */
  reportError?: (error: Error) => void;
}

/**
 * Call an app-supplied `getUserId`, bounded by `timeoutMs`. A synchronous
 * throw, a rejection or a timeout is reported and gives `failed: true`; a
 * result other than a non-empty string gives no `userId`. Never rejects.
 *
 * A failure is reported with a fixed message, so that error text an
 * attacker may influence stays out of log lines and throttle keys; the
 * original error is its `cause`.
 */
export async function resolveUserId(
  getUserId: (() => unknown) | undefined,
  options: ResolveUserIdOptions = {}
): Promise<UserIdResult> {
  if (typeof getUserId !== 'function') return { failed: false };
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS;
  const report = guardReporter(options.reportError ?? defaultReportError);
  try {
    // Inside the async function, a synchronous throw becomes a rejection.
    const pending = (async () => getUserId())();
    let timedOut = false;
    const userId = await withTimeout(pending, timeoutMs, () => {
      timedOut = true;
      report(new Error(`getUserId timed out after ${timeoutMs}ms; evaluating without a user_id`));
      return undefined;
    });
    if (timedOut) return { failed: true };
    return typeof userId === 'string' && userId !== '' ? { userId, failed: false } : { failed: false };
  } catch (error) {
    report(Object.assign(new Error('getUserId failed; evaluating without a user_id'), { cause: error }));
    return { failed: true };
  }
}
