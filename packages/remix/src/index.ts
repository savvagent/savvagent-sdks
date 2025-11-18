/**
 * @savvagent/remix - Remix SDK for Savvagent feature flags
 *
 * This package provides Remix-specific integrations including:
 * - Loader and action helpers
 * - Client-side hooks from @savvagent/react
 * - Server-side flag evaluation
 *
 * @packageDocumentation
 */

// Server-side exports (for loaders and actions)
export {
  initRemixClient,
  getRemixClient,
  getRequestContext,
  isEnabled,
  evaluate,
  withFlag,
  trackError,
  evaluateForRequest,
} from './server';

// Client-side exports (re-export from React SDK)
export {
  SavvagentProvider,
  useSavvagent,
  useFlag,
  useWithFlag,
  useUser,
  useTrackError,
} from '@savvagent/react';

export type {
  SavvagentProviderProps,
  UseFlagOptions,
  UseFlagResult,
} from '@savvagent/react';

// Re-export types from core SDK
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
