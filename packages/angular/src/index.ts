/**
 * @savvagent/angular - Angular SDK for Savvagent feature flags
 *
 * This package provides Angular services and modules for easy integration
 * of Savvagent feature flags into Angular applications.
 *
 * @packageDocumentation
 */

// Module
export { SavvagentModule } from './module';

// Service and types
export { SavvagentService, SAVVAGENT_CONFIG } from './service';
export type {
  SavvagentConfig,
  DefaultFlagContext,
  FlagObservableResult,
  FlagOptions,
} from './service';

// Re-export types from core SDK
export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  EvaluationEvent,
  ErrorEvent,
  FlagUpdateEvent,
  FlagDefinition,
  FlagListResponse,
  // Generated API types for advanced users
  ApiTypes,
  components,
} from '@savvagent/sdk';

// Re-export FlagClient for advanced use cases
export { FlagClient } from '@savvagent/sdk';
