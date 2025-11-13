/**
 * @savvagent/sveltekit - SvelteKit SDK for Savvagent feature flags
 *
 * This package provides SvelteKit-specific integrations including:
 * - Server-side load functions and form actions
 * - Client-side stores from @savvagent/svelte
 *
 * @packageDocumentation
 */

// Re-export client-side functionality from @savvagent/svelte
export {
  initSavvagent,
  getSavvagent,
  createFlagStore,
  createFlag,
  createUserIdStore,
  trackError as trackErrorClient,
} from '@savvagent/svelte';

export type {
  FlagStoreOptions,
  FlagStoreValue,
} from '@savvagent/svelte';

// Re-export types from core SDK
export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  EvaluationEvent,
  ErrorEvent,
  FlagUpdateEvent,
} from '@savvagent/sdk';

// Re-export FlagClient for advanced use cases
export { FlagClient } from '@savvagent/sdk';
