/**
 * `@savvagent/sdk/server`: the request scope shared by the server
 * integrations (`@savvagent/nextjs`, `@savvagent/sveltekit`,
 * `@savvagent/astro`, `@savvagent/react-router`).
 *
 * It covers what every server integration needs to evaluate flags for one
 * request: reading the request's cookies and language, the per-visitor
 * anonymous ID and its cookie, the `user_id` rules (the `user_id` cookie is
 * untrusted unless `trustUserIdCookie` is set; `getUserId` is time-bounded
 * and falls back to anonymous; an explicit `user_id` wins), server-side
 * client defaults, bounded evaluation with a fallback to the flag's
 * default, and error throttling.
 *
 * The module has no runtime dependency on the rest of the SDK: pass it the
 * `FlagClient` (or its constructor) you already use.
 *
 * @packageDocumentation
 */

export {
  ANONYMOUS_ID_COOKIE,
  USER_ID_COOKIE,
  SESSION_ID_COOKIE,
  ANONYMOUS_ID_MAX_AGE,
  parseCookies,
  newAnonymousId,
  anonymousIdCookieOptions,
  serializeAnonymousIdCookie,
  isSecureUrl,
} from './cookies';
export type { AnonymousIdCookieOptions } from './cookies';

export { defaultFor } from '../flags';

export {
  DEFAULT_EVALUATION_TIMEOUT_MS,
  ERROR_REPORT_INTERVAL_MS,
  toServerConfig,
  defaultReportError,
  guardReporter,
  throttleErrors,
  withTimeout,
  fallbackResult,
  evaluateBounded,
  createServerClient,
} from './evaluate';
export type { EvaluatingClient, BoundedEvaluationOptions, ServerClient } from './evaluate';

export {
  mergeContext,
  buildRequestContext,
  assignAnonymousId,
  resolveUserId,
} from './context';
export type { RequestContextInput, UserIdResult, ResolveUserIdOptions } from './context';

export { createRequestScope } from './scope';
export type { RequestScopeOptions, RequestScope } from './scope';
