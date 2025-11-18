/**
 * @savvagent/react - React SDK for Savvagent feature flags
 *
 * This package provides React hooks and components for easy integration
 * of Savvagent feature flags into React applications.
 *
 * @packageDocumentation
 */

// Context and Provider
export { SavvagentProvider, useSavvagent } from './context';
export type { SavvagentProviderProps } from './context';

// Hooks
export {
  useFlag,
  useWithFlag,
  useUser,
  useTrackError,
} from './hooks';
export type {
  UseFlagOptions,
  UseFlagResult,
} from './hooks';

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
