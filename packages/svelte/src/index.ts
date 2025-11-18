/**
 * @savvagent/svelte - Svelte SDK for Savvagent feature flags
 *
 * Provides Svelte stores and utilities for feature flag evaluation.
 * Compatible with both Svelte 4 and Svelte 5 (with runes).
 *
 * @packageDocumentation
 */

import { writable, derived, readable, type Readable, type Writable } from 'svelte/store';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

let clientInstance: FlagClient | null = null;

/**
 * Initialize the Savvagent client.
 * Call this once at app startup (e.g., in +layout.ts or +layout.svelte).
 *
 * @param config - Client configuration
 * @returns The FlagClient instance
 *
 * @example
 * ```ts
 * // +layout.ts
 * import { initSavvagent } from '@savvagent/svelte';
 *
 * export const load = () => {
 *   initSavvagent({
 *     apiKey: 'sdk_...',
 *     applicationId: 'your-app-id',
 *   });
 * };
 * ```
 */
export function initSavvagent(config: FlagClientConfig): FlagClient {
  if (!clientInstance) {
    clientInstance = new FlagClient(config);
  }
  return clientInstance;
}

/**
 * Get the Savvagent client instance.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not initialized
 */
export function getSavvagent(): FlagClient {
  if (!clientInstance) {
    throw new Error('Savvagent client not initialized. Call initSavvagent() first.');
  }
  return clientInstance;
}

export interface FlagStoreOptions {
  /** Context for flag evaluation */
  context?: FlagContext;
  /** Default value while loading or on error */
  defaultValue?: boolean;
  /** Enable real-time updates */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => void;
}

export interface FlagStoreValue {
  /** Current flag value */
  value: boolean;
  /** Whether the flag is loading */
  loading: boolean;
  /** Error if evaluation failed */
  error: Error | null;
  /** Detailed evaluation result */
  result: FlagEvaluationResult | null;
}

/**
 * Create a Svelte store for a feature flag with automatic updates.
 *
 * @param flagKey - The feature flag key
 * @param options - Configuration options
 * @returns Readable store with flag state
 *
 * @example
 * ```svelte
 * <script>
 * import { createFlagStore } from '@savvagent/svelte';
 *
 * const featureFlag = createFlagStore('new-feature', {
 *   context: { user_id: $user?.id },
 *   defaultValue: false,
 *   realtime: true,
 * });
 * </script>
 *
 * {#if $featureFlag.loading}
 *   <p>Loading...</p>
 * {:else if $featureFlag.value}
 *   <NewFeature />
 * {:else}
 *   <OldFeature />
 * {/if}
 * ```
 */
export function createFlagStore(
  flagKey: string,
  options: FlagStoreOptions = {}
): Readable<FlagStoreValue> {
  const client = getSavvagent();
  const {
    context,
    defaultValue = false,
    realtime = true,
    onError,
  } = options;

  return readable<FlagStoreValue>(
    {
      value: defaultValue,
      loading: true,
      error: null,
      result: null,
    },
    (set) => {
      const evaluateFlag = async () => {
        try {
          set({ value: defaultValue, loading: true, error: null, result: null });

          const evalResult = await client.evaluate(flagKey, context);
          set({
            value: evalResult.value,
            loading: false,
            error: null,
            result: evalResult,
          });
        } catch (err) {
          const error = err as Error;
          set({ value: defaultValue, loading: false, error, result: null });
          onError?.(error);
        }
      };

      // Initial evaluation
      evaluateFlag();

      // Real-time updates
      let unsubscribe: (() => void) | null = null;
      if (realtime) {
        unsubscribe = client.subscribe(flagKey, () => {
          evaluateFlag();
        });
      }

      return () => {
        unsubscribe?.();
      };
    }
  );
}

/**
 * Create a simple flag store that returns only the boolean value.
 *
 * @param flagKey - The feature flag key
 * @param options - Configuration options
 * @returns Readable store with boolean value
 *
 * @example
 * ```svelte
 * <script>
 * import { createFlag } from '@savvagent/svelte';
 *
 * const isEnabled = createFlag('new-feature');
 * </script>
 *
 * {#if $isEnabled}
 *   <NewFeature />
 * {/if}
 * ```
 */
export function createFlag(
  flagKey: string,
  options: FlagStoreOptions = {}
): Readable<boolean> {
  const flagStore = createFlagStore(flagKey, options);
  return derived(flagStore, ($flag) => $flag.value);
}

/**
 * Create a writable store for user ID management.
 *
 * @returns Writable store for user ID
 *
 * @example
 * ```svelte
 * <script>
 * import { createUserIdStore } from '@savvagent/svelte';
 *
 * const userId = createUserIdStore();
 *
 * // Set user ID on login
 * $userId = user.id;
 *
 * // Clear on logout
 * $userId = null;
 * </script>
 * ```
 */
export function createUserIdStore(): Writable<string | null> {
  const client = getSavvagent();
  const store = writable<string | null>(client.getUserId());

  return {
    subscribe: store.subscribe,
    set: (value: string | null) => {
      client.setUserId(value);
      store.set(value);
    },
    update: (fn: (value: string | null) => string | null) => {
      store.update((current) => {
        const newValue = fn(current);
        client.setUserId(newValue);
        return newValue;
      });
    },
  };
}

/**
 * Track an error with flag context.
 *
 * @param flagKey - The flag key associated with the error
 * @param error - The error that occurred
 * @param context - Optional context
 *
 * @example
 * ```svelte
 * <script>
 * import { trackError } from '@savvagent/svelte';
 *
 * async function handlePayment() {
 *   try {
 *     await processPayment();
 *   } catch (error) {
 *     trackError('new-payment-flow', error);
 *   }
 * }
 * </script>
 * ```
 */
export function trackError(
  flagKey: string,
  error: Error,
  context?: FlagContext
): void {
  const client = getSavvagent();
  client.trackError(flagKey, error, context);
}

// Re-export types
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
