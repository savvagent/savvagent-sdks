/**
 * @savvagent/react-router - React Router 8 SDK for Savvagent feature flags
 *
 * - Server: evaluate flags in loaders, actions and route middleware with a
 *   per-request context (`createSavvagentServer`, `getSavvagent`).
 * - Client: the `@savvagent/react` provider and hooks, hydrated with the
 *   server's results so the first render shows real values, not defaults.
 *
 * @packageDocumentation
 */

// Server-side (loaders, actions, middleware)
export {
  createSavvagentServer,
  getSavvagent,
  savvagentContext,
  parseCookies,
  toServerConfig,
  throttleErrors,
  DEFAULT_EVALUATION_TIMEOUT_MS,
  ERROR_REPORT_INTERVAL_MS,
  ANONYMOUS_ID_COOKIE,
  USER_ID_COOKIE,
  SESSION_ID_COOKIE,
} from './server';
export type {
  SavvagentServer,
  SavvagentServerOptions,
  SavvagentRequest,
  SavvagentFlags,
  ForRequestOptions,
  UserIdArgs,
} from './server';

// Client-side: provider and flag hooks with hydration
export { SavvagentProvider, useFlag, useFlags, useHydratedFlags } from './client';
export type { SavvagentProviderProps } from './client';

// Client-side: the remaining @savvagent/react hooks, unchanged
export { useSavvagent, useWithFlag, useUser, useTrackError, useEnvironment } from '@savvagent/react';
export type {
  DefaultFlagContext,
  UseFlagOptions,
  UseFlagResult,
  UseFlagsOptions,
  UseFlagsResult,
} from '@savvagent/react';

// Types from the core SDK
export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  EvaluationEvent,
  ErrorEvent,
  FlagUpdateEvent,
  FlagDefinition,
  FlagListResponse,
  ApiTypes,
  components,
} from '@savvagent/sdk';

// FlagClient for advanced use cases
export { FlagClient } from '@savvagent/sdk';
