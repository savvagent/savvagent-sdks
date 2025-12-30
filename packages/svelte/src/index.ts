/**
 * @savvagent/svelte - Svelte SDK for Savvagent feature flags
 *
 * Provides Svelte stores and utilities for feature flag evaluation.
 * Compatible with both Svelte 4 and Svelte 5 (with runes).
 *
 * @packageDocumentation
 */

import { writable, derived, readable, type Readable, type Writable } from 'svelte/store';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult, FlagDefinition } from '@savvagent/sdk';

let clientInstance: FlagClient | null = null;
let defaultContext: FlagContext = {};

/**
 * Default context applied to all flag evaluations.
 * Similar to React's defaultContext in SavvagentProvider.
 */
export interface DefaultFlagContext {
  /** Environment (development, staging, production) */
  environment?: string;
  /** User ID for logged-in users */
  userId?: string;
  /** Organization ID for multi-tenant apps */
  organizationId?: string;
  /** Anonymous ID for anonymous users */
  anonymousId?: string;
  /** Session ID as fallback identifier */
  sessionId?: string;
  /** User's language code */
  language?: string;
  /** Custom attributes for targeting rules */
  attributes?: Record<string, unknown>;
}

/**
 * Configuration for Savvagent initialization.
 */
export interface SavvagentConfig {
  /** FlagClient configuration */
  config: FlagClientConfig;
  /** Default context applied to all flag evaluations */
  defaultContext?: DefaultFlagContext;
}

/**
 * Initialize the Savvagent client.
 * Call this once at app startup (e.g., in +layout.ts or +layout.svelte).
 *
 * @param config - Client configuration or full SavvagentConfig
 * @param contextOverride - Optional default context (deprecated, use SavvagentConfig instead)
 * @returns The FlagClient instance
 *
 * @example
 * ```ts
 * // +layout.ts
 * import { initSavvagent } from '@savvagent/svelte';
 *
 * export const load = () => {
 *   initSavvagent({
 *     config: {
 *       apiKey: 'sdk_...',
 *       applicationId: 'your-app-id',
 *     },
 *     defaultContext: {
 *       environment: 'development',
 *       userId: 'user-123',
 *     },
 *   });
 * };
 * ```
 */
export function initSavvagent(
  config: FlagClientConfig | SavvagentConfig,
  contextOverride?: DefaultFlagContext
): FlagClient {
  if (!clientInstance) {
    // Handle both old and new API
    if ('config' in config) {
      clientInstance = new FlagClient(config.config);
      if (config.defaultContext) {
        defaultContext = mapDefaultContext(config.defaultContext);
        // Set the user ID on the client from defaultContext for createUserIdStore() to pick up
        if (config.defaultContext.userId) {
          clientInstance.setUserId(config.defaultContext.userId);
        }
      }
    } else {
      clientInstance = new FlagClient(config);
    }

    if (contextOverride) {
      defaultContext = mapDefaultContext(contextOverride);
      // Set the user ID on the client from contextOverride for createUserIdStore() to pick up
      if (contextOverride.userId) {
        clientInstance.setUserId(contextOverride.userId);
      }
    }
  }
  return clientInstance;
}

/**
 * Map DefaultFlagContext to FlagContext format.
 */
function mapDefaultContext(ctx: DefaultFlagContext): FlagContext {
  return {
    environment: ctx.environment,
    user_id: ctx.userId,
    organization_id: ctx.organizationId,
    anonymous_id: ctx.anonymousId,
    session_id: ctx.sessionId,
    language: ctx.language,
    attributes: ctx.attributes,
  };
}

/**
 * Get the current default context.
 */
export function getDefaultContext(): FlagContext {
  return defaultContext;
}

/**
 * Set the default context for all flag evaluations.
 */
export function setDefaultContext(ctx: DefaultFlagContext): void {
  defaultContext = mapDefaultContext(ctx);
}

/**
 * Set the environment for flag evaluation.
 * Useful for dynamically switching environments (e.g., dev tools).
 *
 * @param environment - The environment name (e.g., "development", "staging", "production")
 *
 * @example
 * ```ts
 * import { setEnvironment } from '@savvagent/svelte';
 *
 * // Switch to staging environment
 * setEnvironment('staging');
 * ```
 */
export function setEnvironment(environment: string): void {
  const client = getSavvagent();
  client.setEnvironment(environment);
}

/**
 * Get the current environment.
 *
 * @returns The current environment name
 *
 * @example
 * ```ts
 * import { getEnvironment } from '@savvagent/svelte';
 *
 * const env = getEnvironment();
 * console.log(`Current environment: ${env}`);
 * ```
 */
export function getEnvironment(): string {
  const client = getSavvagent();
  return client.getEnvironment();
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
 * Merge default context with per-call context.
 * Per-call context values override defaults.
 */
function mergeContext(context?: FlagContext): FlagContext {
  return {
    ...defaultContext,
    ...context,
    attributes: {
      ...defaultContext?.attributes,
      ...context?.attributes,
    },
  };
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

  // Merge default context with per-call context
  const mergedContext = mergeContext(context);

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

          const evalResult = await client.evaluate(flagKey, mergedContext);
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
      let unsubscribeRealtime: (() => void) | null = null;
      if (realtime) {
        unsubscribeRealtime = client.subscribe(flagKey, () => {
          evaluateFlag();
        });
      }

      // Subscribe to override changes
      const unsubscribeOverrides = client.onOverrideChange(() => {
        evaluateFlag();
      });

      return () => {
        unsubscribeRealtime?.();
        unsubscribeOverrides();
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

// =====================
// Multiple Flags Store
// =====================

export interface FlagsStoreOptions {
  /** Context for flag evaluation */
  context?: FlagContext;
  /** Default values for flags (keyed by flag key) */
  defaultValues?: Record<string, boolean>;
  /** Enable real-time updates for these flags */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error, flagKey: string) => void;
}

export interface FlagsStoreValue {
  /** Map of flag keys to their current values */
  values: Record<string, boolean>;
  /** Whether any flag is currently being evaluated */
  loading: boolean;
  /** Map of flag keys to their errors (if any) */
  errors: Record<string, Error | null>;
  /** Map of flag keys to their detailed evaluation results */
  results: Record<string, FlagEvaluationResult | null>;
}

/**
 * Create a Svelte store for multiple feature flags with a single subscription.
 * This is more efficient than using multiple createFlagStore calls when you need
 * several flags in the same component, as it reduces re-render surface.
 *
 * @param flagKeys - Array of feature flag keys to evaluate
 * @param options - Configuration options
 * @returns Readable store with flag states
 *
 * @example
 * ```svelte
 * <script>
 * import { createFlagsStore } from '@savvagent/svelte';
 *
 * const flags = createFlagsStore(
 *   ['feature-a', 'feature-b', 'feature-c'],
 *   {
 *     defaultValues: { 'feature-a': false, 'feature-b': true },
 *     realtime: true
 *   }
 * );
 * </script>
 *
 * {#if $flags.loading}
 *   <p>Loading...</p>
 * {:else}
 *   {#if $flags.values['feature-a']}
 *     <FeatureA />
 *   {/if}
 *   {#if $flags.values['feature-b']}
 *     <FeatureB />
 *   {/if}
 * {/if}
 * ```
 */
export function createFlagsStore(
  flagKeys: string[],
  options: FlagsStoreOptions = {}
): Readable<FlagsStoreValue> & { refetch: () => Promise<void> } {
  const client = getSavvagent();
  const {
    context,
    defaultValues = {},
    realtime = true,
    onError,
  } = options;

  // Merge default context with per-call context
  const mergedContext = mergeContext(context);

  // Initialize values
  const initialValues: Record<string, boolean> = {};
  const initialErrors: Record<string, Error | null> = {};
  const initialResults: Record<string, FlagEvaluationResult | null> = {};

  for (const key of flagKeys) {
    initialValues[key] = defaultValues[key] ?? false;
    initialErrors[key] = null;
    initialResults[key] = null;
  }

  const store = writable<FlagsStoreValue>({
    values: initialValues,
    loading: true,
    errors: initialErrors,
    results: initialResults,
  });

  let evaluateFlags: () => Promise<void>;

  const { subscribe } = readable<FlagsStoreValue>(
    {
      values: initialValues,
      loading: true,
      errors: initialErrors,
      results: initialResults,
    },
    (set) => {
      evaluateFlags = async () => {
        store.update((s) => (s.loading ? s : { ...s, loading: true }));

        const newValues: Record<string, boolean> = {};
        const newErrors: Record<string, Error | null> = {};
        const newResults: Record<string, FlagEvaluationResult | null> = {};

        // Evaluate all flags in parallel
        await Promise.all(
          flagKeys.map(async (flagKey) => {
            try {
              const evalResult = await client.evaluate(flagKey, mergedContext);
              newValues[flagKey] = evalResult.value;
              newErrors[flagKey] = null;
              newResults[flagKey] = evalResult;
            } catch (err) {
              const error = err as Error;
              newValues[flagKey] = defaultValues[flagKey] ?? false;
              newErrors[flagKey] = error;
              newResults[flagKey] = null;
              onError?.(error, flagKey);
            }
          })
        );

        // Single atomic state update for all flags
        const newState = {
          values: newValues,
          loading: false,
          errors: newErrors,
          results: newResults,
        };
        store.set(newState);
        set(newState);
      };

      // Initial evaluation
      evaluateFlags();

      // Real-time updates - subscribe to all flags
      const unsubscribes: (() => void)[] = [];
      if (realtime) {
        for (const flagKey of flagKeys) {
          unsubscribes.push(
            client.subscribe(flagKey, () => {
              evaluateFlags();
            })
          );
        }
      }

      // Subscribe to override changes
      const unsubscribeOverrides = client.onOverrideChange(() => {
        evaluateFlags();
      });

      return () => {
        unsubscribes.forEach((unsub) => unsub());
        unsubscribeOverrides();
      };
    }
  );

  return {
    subscribe,
    refetch: () => evaluateFlags(),
  };
}

// =====================
// Override Management
// =====================

export interface OverridesStoreValue {
  /** Current overrides map */
  overrides: Record<string, boolean>;
  /** Number of active overrides */
  count: number;
}

/**
 * Create a store for managing local flag overrides.
 * Automatically syncs with localStorage and the FlagClient.
 *
 * @returns Store with override management methods
 *
 * @example
 * ```svelte
 * <script>
 * import { createOverridesStore } from '@savvagent/svelte';
 *
 * const overrides = createOverridesStore();
 *
 * // Set an override
 * overrides.set('new-feature', true);
 *
 * // Clear an override
 * overrides.clear('new-feature');
 *
 * // Clear all overrides
 * overrides.clearAll();
 * </script>
 *
 * <p>Active overrides: {$overrides.count}</p>
 * ```
 */
export function createOverridesStore(): Readable<OverridesStoreValue> & {
  set: (flagKey: string, value: boolean) => void;
  clear: (flagKey: string) => void;
  clearAll: () => void;
  has: (flagKey: string) => boolean;
  get: (flagKey: string) => boolean | undefined;
} {
  const STORAGE_KEY = 'savvagent_local_overrides';
  const client = getSavvagent();

  // Load initial overrides from localStorage
  let initialOverrides: Record<string, boolean> = {};
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        initialOverrides = JSON.parse(stored);
        // Apply to client
        client.setOverrides(initialOverrides);
      }
    } catch (e) {
      console.warn('[Savvagent] Failed to load overrides from localStorage:', e);
    }
  }

  const store = writable<OverridesStoreValue>({
    overrides: initialOverrides,
    count: Object.keys(initialOverrides).length,
  });

  // Subscribe to client override changes
  client.onOverrideChange(() => {
    const overrides = client.getOverrides();
    store.set({
      overrides,
      count: Object.keys(overrides).length,
    });
  });

  // Persist to localStorage when overrides change
  store.subscribe((value) => {
    if (typeof localStorage !== 'undefined') {
      try {
        if (value.count > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(value.overrides));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        console.warn('[Savvagent] Failed to save overrides to localStorage:', e);
      }
    }
  });

  return {
    subscribe: store.subscribe,
    set: (flagKey: string, value: boolean) => {
      client.setOverride(flagKey, value);
    },
    clear: (flagKey: string) => {
      client.clearOverride(flagKey);
    },
    clearAll: () => {
      client.clearAllOverrides();
    },
    has: (flagKey: string) => {
      return client.hasOverride(flagKey);
    },
    get: (flagKey: string) => {
      return client.getOverride(flagKey);
    },
  };
}

/**
 * Create a store that tracks all available flags (for dev tools).
 *
 * @param environment - Environment to fetch flags for
 * @returns Store with all flags and loading state
 *
 * @example
 * ```svelte
 * <script>
 * import { createAllFlagsStore } from '@savvagent/svelte';
 *
 * const allFlags = createAllFlagsStore('development');
 * </script>
 *
 * {#each $allFlags.flags as flag}
 *   <div>{flag.key}: {flag.enabled ? 'ON' : 'OFF'}</div>
 * {/each}
 * ```
 */
export function createAllFlagsStore(
  environment: string = 'development'
): Readable<{ flags: FlagDefinition[]; loading: boolean; error: Error | null }> & {
  refetch: () => Promise<void>;
} {
  const client = getSavvagent();

  let refetchFn: () => Promise<void>;

  const { subscribe } = readable<{
    flags: FlagDefinition[];
    loading: boolean;
    error: Error | null;
  }>(
    { flags: [], loading: true, error: null },
    (set) => {
      refetchFn = async () => {
        set({ flags: [], loading: true, error: null });
        try {
          const flags = await client.getAllFlags(environment);
          set({ flags, loading: false, error: null });
        } catch (err) {
          set({ flags: [], loading: false, error: err as Error });
        }
      };

      refetchFn();

      return () => {};
    }
  );

  return {
    subscribe,
    refetch: () => refetchFn(),
  };
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
  FlagDefinition,
  EvaluationEvent,
  ErrorEvent,
  FlagUpdateEvent,
  // Generated API types for advanced users
  ApiTypes,
  components,
} from '@savvagent/sdk';

// Re-export FlagClient for advanced use cases
export { FlagClient } from '@savvagent/sdk';
