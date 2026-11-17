/**
 * Internal: trust narrowing for the request helpers. Not exported from the
 * package entry points.
 */
import type { FlagContext } from '@savvagent/sdk';
import type { RequestScope } from '@savvagent/sdk/server';
import type { RequestHelperOptions, SavvagentLocals } from './index';

export interface LocalsInternals {
  cookieUser(): Promise<boolean>;
  cookieUserNow(): boolean;
  withoutUser(): RequestScope;
}

/** Provenance of a locals scope's `user_id`, for helpers that narrow trust (see `helperScope`). */
export const localsInternals = new WeakMap<SavvagentLocals, LocalsInternals>();

/**
 * `locals` as seen by a helper that does not trust the `user_id` cookie: when
 * the request's user came from the cookie, calls evaluate without it, and
 * `context` omits it. The user is settled first, so one from `getUserId` is
 * kept.
 */
export function withoutCookieUser(existing: SavvagentLocals): SavvagentLocals | undefined {
  const internals = localsInternals.get(existing);
  // Not a scope created by createSavvagentLocals (for example a copy of it), so
  // the user's source is unknown. The caller falls back to a fresh scope.
  if (!internals) return undefined;
  const target = async (): Promise<SavvagentLocals> => ((await internals.cookieUser()) ? internals.withoutUser() : existing);
  return {
    client: existing.client,
    // The narrowed view: no `user_id` while the user is the cookie's. Read at
    // access time, so it reflects the settled user (a getUserId user is kept).
    get context(): FlagContext {
      if (!internals.cookieUserNow()) return existing.context;
      const { user_id: _cookieUser, ...rest } = existing.context;
      return rest;
    },
    isEnabled: async (flagKey, context) => (await target()).isEnabled(flagKey, context),
    evaluate: async (flagKey, context) => (await target()).evaluate(flagKey, context),
    withFlag: async (flagKey, callback, context) => (await target()).withFlag(flagKey, callback, context),
    // Synchronous: before the user is settled, assume it is the cookie's.
    trackError: (flagKey, error, context) =>
      (internals.cookieUserNow() ? internals.withoutUser() : existing).trackError(flagKey, error, context),
  };
}

/**
 * The request scope the helpers evaluate with: the request's
 * `Astro.locals.savvagent` when it exists, else a new scope with the same
 * rules (and no anonymous ID cookie of its own), made by `fresh`.
 */
export function helperScope(
  options: RequestHelperOptions,
  fresh: () => SavvagentLocals
): SavvagentLocals {
  const existing = (options.locals as Partial<App.Locals> | undefined)?.savvagent;
  if (existing) {
    if (options.trustUserIdCookie !== false) return existing;
    const narrowed = withoutCookieUser(existing);
    if (narrowed) return narrowed;
    // Fail closed: narrowing was asked for, but the reused scope is unknown,
    // so evaluate with a fresh scope that does not trust the cookie.
  }
  return fresh();
}
