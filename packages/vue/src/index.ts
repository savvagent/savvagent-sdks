/**
 * @savvagent/vue - Vue SDK for Savvagent feature flags
 *
 * Provides Vue 3 Composition API composables for feature flag evaluation.
 *
 * @packageDocumentation
 */

import {
  ref,
  onMounted,
  onUnmounted,
  inject,
  provide,
  type Ref,
  type InjectionKey,
  type App,
} from 'vue';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

// Injection keys
const SavvagentClientKey: InjectionKey<FlagClient> = Symbol('SavvagentClient');
const SavvagentDefaultContextKey: InjectionKey<Ref<FlagContext>> = Symbol('SavvagentDefaultContext');
const SavvagentReadyKey: InjectionKey<Ref<boolean>> = Symbol('SavvagentReady');

/**
 * Default context values that apply to all flag evaluations
 * Per SDK Developer Guide: Context fields for flag evaluation
 */
export interface DefaultFlagContext {
  /** Application ID for application-scoped flags */
  applicationId?: string;
  /** Environment (development, staging, production) */
  environment?: string;
  /** Organization ID for multi-tenant apps */
  organizationId?: string;
  /** Default user ID (required for percentage rollouts) */
  userId?: string;
  /** Default anonymous ID (alternative to userId for anonymous users) */
  anonymousId?: string;
  /** Session ID as fallback identifier */
  sessionId?: string;
  /** User's language code (e.g., "en", "es") */
  language?: string;
  /** Default attributes for targeting */
  attributes?: Record<string, unknown>;
}

/**
 * Plugin options for SavvagentPlugin
 */
export interface SavvagentPluginOptions {
  /** Client configuration */
  config: FlagClientConfig;
  /** Default context values applied to all flag evaluations */
  defaultContext?: DefaultFlagContext;
  /** Initial flag overrides to apply on mount (e.g., from localStorage) */
  initialOverrides?: Record<string, boolean>;
}

/**
 * Convert DefaultFlagContext to FlagContext format (camelCase to snake_case)
 */
function normalizeContext(defaultContext?: DefaultFlagContext): FlagContext {
  if (!defaultContext) return {};
  return {
    application_id: defaultContext.applicationId,
    environment: defaultContext.environment,
    organization_id: defaultContext.organizationId,
    user_id: defaultContext.userId,
    anonymous_id: defaultContext.anonymousId,
    session_id: defaultContext.sessionId,
    language: defaultContext.language,
    attributes: defaultContext.attributes,
  };
}

/**
 * Vue plugin to install Savvagent globally.
 *
 * @param app - Vue app instance
 * @param options - Plugin options with config and defaultContext
 *
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { SavvagentPlugin } from '@savvagent/vue';
 *
 * const app = createApp(App);
 * app.use(SavvagentPlugin, {
 *   config: {
 *     apiKey: 'sdk_...',
 *     applicationId: 'your-app-id',
 *   },
 *   defaultContext: {
 *     environment: 'development',
 *     userId: 'user-123',
 *   },
 * });
 * ```
 */
export const SavvagentPlugin = {
  install(app: App, options: SavvagentPluginOptions | FlagClientConfig) {
    // Support both old format (just config) and new format (options object)
    const config = 'config' in options ? options.config : options;
    const defaultContext = 'defaultContext' in options ? options.defaultContext : undefined;
    const initialOverrides = 'initialOverrides' in options ? options.initialOverrides : undefined;

    const client = new FlagClient(config);
    const normalizedContext = ref<FlagContext>(normalizeContext(defaultContext));
    const isReady = ref(true);

    // Initialize userId from defaultContext if provided
    if (defaultContext?.userId) {
      client.setUserId(defaultContext.userId);
    }

    // Apply initial overrides if provided
    if (initialOverrides && Object.keys(initialOverrides).length > 0) {
      client.setOverrides(initialOverrides);
    }

    app.provide(SavvagentClientKey, client);
    app.provide(SavvagentDefaultContextKey, normalizedContext);
    app.provide(SavvagentReadyKey, isReady);

    // Expose on global properties for debugging
    app.config.globalProperties.$savvagent = client;
  },
};

/**
 * Provide the Savvagent client to child components.
 * Alternative to using the plugin.
 *
 * @param config - Client configuration
 * @param defaultContext - Default context values applied to all flag evaluations
 * @returns The FlagClient instance
 *
 * @example
 * ```vue
 * <script setup>
 * import { provideSavvagent } from '@savvagent/vue';
 *
 * provideSavvagent(
 *   { apiKey: 'sdk_...' },
 *   { environment: 'development', userId: 'user-123' }
 * );
 * </script>
 * ```
 */
export function provideSavvagent(
  config: FlagClientConfig,
  defaultContext?: DefaultFlagContext
): FlagClient {
  const client = new FlagClient(config);
  const normalizedContext = ref<FlagContext>(normalizeContext(defaultContext));
  const isReady = ref(true);

  provide(SavvagentClientKey, client);
  provide(SavvagentDefaultContextKey, normalizedContext);
  provide(SavvagentReadyKey, isReady);

  return client;
}

/**
 * Return type for useSavvagent composable
 */
export interface UseSavvagentReturn {
  /** The FlagClient instance */
  client: FlagClient;
  /** Whether the client is ready */
  isReady: Ref<boolean>;
  /** Default context values for flag evaluations */
  defaultContext: Ref<FlagContext>;
}

/**
 * Get the Savvagent client instance and context.
 * Must be used within a component that has the plugin installed or provideSavvagent called.
 *
 * @returns The FlagClient instance, ready state, and default context
 * @throws Error if client is not provided
 *
 * @example
 * ```vue
 * <script setup>
 * import { useSavvagent } from '@savvagent/vue';
 *
 * const { client, isReady, defaultContext } = useSavvagent();
 * const enabled = await client.isEnabled('my-feature');
 * </script>
 * ```
 */
export function useSavvagent(): UseSavvagentReturn {
  const client = inject(SavvagentClientKey);
  const defaultContext = inject(SavvagentDefaultContextKey);
  const isReady = inject(SavvagentReadyKey);

  if (!client) {
    throw new Error(
      'Savvagent client not found. Use the SavvagentPlugin or provideSavvagent first.'
    );
  }

  return {
    client,
    isReady: isReady ?? ref(true),
    defaultContext: defaultContext ?? ref({}),
  };
}

export interface UseFlagOptions {
  /** Context for flag evaluation */
  context?: FlagContext;
  /** Default value while loading or on error */
  defaultValue?: boolean;
  /** Enable real-time updates */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => void;
}

export interface UseFlagReturn {
  /** Current flag value */
  value: Ref<boolean>;
  /** Whether the flag is loading */
  loading: Ref<boolean>;
  /** Error if evaluation failed */
  error: Ref<Error | null>;
  /** Detailed evaluation result */
  result: Ref<FlagEvaluationResult | null>;
  /** Force re-evaluation */
  refetch: () => Promise<void>;
}

/**
 * Merge default context from provider with per-call context
 */
function mergeContext(defaultCtx: FlagContext, callCtx?: FlagContext): FlagContext {
  if (!callCtx) return defaultCtx;
  return {
    ...defaultCtx,
    ...callCtx,
    // Deep merge attributes
    attributes: {
      ...defaultCtx.attributes,
      ...callCtx.attributes,
    },
  };
}

/**
 * Composable to evaluate a feature flag with automatic updates.
 *
 * @param flagKey - The feature flag key
 * @param options - Configuration options
 * @returns Reactive flag state
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlag } from '@savvagent/vue';
 *
 * const { value: isEnabled, loading } = useFlag('new-feature', {
 *   context: { user_id: user.value?.id },
 *   defaultValue: false,
 *   realtime: true,
 * });
 * </script>
 *
 * <template>
 *   <div v-if="loading">Loading...</div>
 *   <NewFeature v-else-if="isEnabled" />
 *   <OldFeature v-else />
 * </template>
 * ```
 */
export function useFlag(
  flagKey: string,
  options: UseFlagOptions = {}
): UseFlagReturn {
  const { client, isReady, defaultContext } = useSavvagent();
  const {
    context,
    defaultValue = false,
    realtime = true,
    onError,
  } = options;

  const value = ref<boolean>(defaultValue);
  const loading = ref<boolean>(true);
  const error = ref<Error | null>(null);
  const result = ref<FlagEvaluationResult | null>(null);

  const evaluateFlag = async () => {
    if (!isReady.value) return;

    try {
      loading.value = true;
      error.value = null;

      // Merge default context with per-call context
      const mergedContext = mergeContext(defaultContext.value, context);
      const evalResult = await client.evaluate(flagKey, mergedContext);
      value.value = evalResult.value;
      result.value = evalResult;
    } catch (err) {
      const evalError = err as Error;
      error.value = evalError;
      value.value = defaultValue;
      onError?.(evalError);
    } finally {
      loading.value = false;
    }
  };

  // Initial evaluation
  onMounted(() => {
    evaluateFlag();
  });

  // Real-time updates subscription
  onMounted(() => {
    if (!realtime) return;

    const unsubscribe = client.subscribe(flagKey, () => {
      evaluateFlag();
    });

    onUnmounted(() => {
      unsubscribe();
    });
  });

  // Subscribe to override changes
  onMounted(() => {
    const unsubscribe = client.onOverrideChange(() => {
      evaluateFlag();
    });

    onUnmounted(() => {
      unsubscribe();
    });
  });

  return {
    value,
    loading,
    error,
    result,
    refetch: evaluateFlag,
  };
}

export interface UseFlagsOptions {
  /** Context for flag evaluation (user_id, attributes, etc.) */
  context?: FlagContext;
  /** Default values for flags (keyed by flag key) */
  defaultValues?: Record<string, boolean>;
  /** Enable real-time updates for these flags */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error, flagKey: string) => void;
}

export interface UseFlagsReturn {
  /** Map of flag keys to their current values */
  values: Ref<Record<string, boolean>>;
  /** Whether any flag is currently being evaluated */
  loading: Ref<boolean>;
  /** Map of flag keys to their errors (if any) */
  errors: Ref<Record<string, Error | null>>;
  /** Map of flag keys to their detailed evaluation results */
  results: Ref<Record<string, FlagEvaluationResult | null>>;
  /** Force re-evaluation of all flags */
  refetch: () => Promise<void>;
}

/**
 * Composable to evaluate multiple feature flags with a single subscription.
 * This is more efficient than using multiple useFlag composables when you need
 * several flags in the same component, as it reduces reactive overhead.
 *
 * @param flagKeys - Array of feature flag keys to evaluate
 * @param options - Configuration options
 * @returns Flag evaluation state and controls for all flags
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFlags } from '@savvagent/vue';
 *
 * const { values, loading } = useFlags(
 *   ['feature-a', 'feature-b', 'feature-c'],
 *   {
 *     defaultValues: { 'feature-a': false, 'feature-b': true },
 *     realtime: true,
 *   }
 * );
 * </script>
 *
 * <template>
 *   <div v-if="loading">Loading...</div>
 *   <div v-else>
 *     <FeatureA v-if="values['feature-a']" />
 *     <FeatureB v-if="values['feature-b']" />
 *     <FeatureC v-if="values['feature-c']" />
 *   </div>
 * </template>
 * ```
 */
export function useFlags(
  flagKeys: string[],
  options: UseFlagsOptions = {}
): UseFlagsReturn {
  const { client, isReady, defaultContext } = useSavvagent();
  const {
    context,
    defaultValues = {},
    realtime = true,
    onError,
  } = options;

  // Initialize state with default values
  const initialValues: Record<string, boolean> = {};
  const initialErrors: Record<string, Error | null> = {};
  const initialResults: Record<string, FlagEvaluationResult | null> = {};

  for (const key of flagKeys) {
    initialValues[key] = defaultValues[key] ?? false;
    initialErrors[key] = null;
    initialResults[key] = null;
  }

  const values = ref<Record<string, boolean>>(initialValues);
  const loading = ref<boolean>(true);
  const errors = ref<Record<string, Error | null>>(initialErrors);
  const results = ref<Record<string, FlagEvaluationResult | null>>(initialResults);

  const evaluateFlags = async () => {
    if (!isReady.value) return;

    loading.value = true;

    const newValues: Record<string, boolean> = {};
    const newErrors: Record<string, Error | null> = {};
    const newResults: Record<string, FlagEvaluationResult | null> = {};

    // Merge default context with per-call context
    const mergedContext = mergeContext(defaultContext.value, context);

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
    values.value = newValues;
    errors.value = newErrors;
    results.value = newResults;
    loading.value = false;
  };

  // Initial evaluation
  onMounted(() => {
    evaluateFlags();
  });

  // Real-time updates - subscribe to all flags
  onMounted(() => {
    if (!realtime) return;

    const unsubscribes = flagKeys.map((flagKey) =>
      client.subscribe(flagKey, () => {
        evaluateFlags();
      })
    );

    onUnmounted(() => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    });
  });

  // Subscribe to override changes
  onMounted(() => {
    const unsubscribe = client.onOverrideChange(() => {
      evaluateFlags();
    });

    onUnmounted(() => {
      unsubscribe();
    });
  });

  return {
    values,
    loading,
    errors,
    results,
    refetch: evaluateFlags,
  };
}

/**
 * Composable to execute a callback conditionally based on a flag value.
 *
 * @param flagKey - The feature flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param options - Configuration options
 *
 * @example
 * ```vue
 * <script setup>
 * import { useWithFlag } from '@savvagent/vue';
 *
 * useWithFlag('analytics-enabled', async () => {
 *   await trackEvent('page_view');
 * });
 * </script>
 * ```
 */
export function useWithFlag(
  flagKey: string,
  callback: () => void | Promise<void>,
  options: UseFlagOptions = {}
): void {
  const { client, isReady, defaultContext } = useSavvagent();
  const { context, onError } = options;

  onMounted(async () => {
    if (!isReady.value) return;

    try {
      const mergedContext = mergeContext(defaultContext.value, context);
      await client.withFlag(flagKey, callback, mergedContext);
    } catch (error) {
      console.error(`[Savvagent] Error in withFlag callback for ${flagKey}:`, error);
      onError?.(error as Error);
    }
  });
}

/**
 * Composable to manage user identification with reactive state.
 *
 * @returns User ID state and management functions
 *
 * @example
 * ```vue
 * <script setup>
 * import { useUser } from '@savvagent/vue';
 *
 * const { userId, setUserId } = useUser();
 * </script>
 *
 * <template>
 *   <p>User: {{ userId || 'Not set' }}</p>
 *   <button @click="setUserId('user-123')">Set User</button>
 * </template>
 * ```
 */
export function useUser() {
  const { client } = useSavvagent();

  // Reactive refs for userId and anonymousId
  const userId = ref<string | null>(client.getUserId());
  const anonymousId = ref<string | null>(client.getAnonymousId());

  return {
    userId,
    anonymousId,
    setUserId: (newUserId: string | null) => {
      client.setUserId(newUserId);
      userId.value = newUserId;
    },
    getUserId: () => client.getUserId(),
    getAnonymousId: () => client.getAnonymousId(),
    setAnonymousId: (id: string) => {
      client.setAnonymousId(id);
      anonymousId.value = id;
    },
  };
}

/**
 * Composable to manage the environment for flag evaluation.
 *
 * @returns Environment management functions
 *
 * @example
 * ```vue
 * <script setup>
 * import { useEnvironment } from '@savvagent/vue';
 *
 * const { environment, setEnvironment } = useEnvironment();
 * </script>
 *
 * <template>
 *   <select :value="environment" @change="setEnvironment($event.target.value)">
 *     <option value="development">Development</option>
 *     <option value="staging">Staging</option>
 *     <option value="production">Production</option>
 *   </select>
 * </template>
 * ```
 */
export function useEnvironment() {
  const { client } = useSavvagent();
  const environment = ref<string>(client.getEnvironment());

  const setEnvironment = (env: string) => {
    client.setEnvironment(env);
    environment.value = env;
  };

  const getEnvironment = () => client.getEnvironment();

  return {
    environment,
    setEnvironment,
    getEnvironment,
  };
}

/**
 * Composable to track errors with flag context.
 *
 * @param flagKey - The flag key associated with errors
 * @param context - Optional context
 * @returns Error tracking function
 *
 * @example
 * ```vue
 * <script setup>
 * import { useTrackError } from '@savvagent/vue';
 *
 * const trackError = useTrackError('new-payment-flow');
 *
 * async function processPayment() {
 *   try {
 *     await pay();
 *   } catch (error) {
 *     trackError(error);
 *   }
 * }
 * </script>
 * ```
 */
export function useTrackError(flagKey: string, context?: FlagContext) {
  const { client } = useSavvagent();

  return (error: Error) => {
    client.trackError(flagKey, error, context);
  };
}

/**
 * Composable to use local overrides with automatic re-render on changes.
 * This composable subscribes to the client's override changes.
 *
 * @returns Reactive overrides map
 *
 * @example
 * ```vue
 * <script setup>
 * import { useLocalOverrides } from '@savvagent/vue';
 *
 * const overrides = useLocalOverrides();
 * // Access: overrides.value['my-flag']
 * </script>
 * ```
 */
export function useLocalOverrides(): Ref<Record<string, boolean>> {
  const { client } = useSavvagent();
  const overrides = ref<Record<string, boolean>>(client.getOverrides());

  onMounted(() => {
    // Subscribe to changes
    const unsubscribe = client.onOverrideChange(() => {
      overrides.value = client.getOverrides();
    });

    onUnmounted(() => {
      unsubscribe();
    });
  });

  return overrides;
}

/**
 * Get the effective flag value considering local overrides.
 * Note: This is only needed if you're manually managing values.
 * The useFlag/useFlags composables automatically respect overrides.
 *
 * @param flagKey - The flag key
 * @param serverValue - The value from the server
 * @param overrides - The local overrides map
 * @returns The effective value (override if present, otherwise server value)
 */
export function getOverriddenValue(
  flagKey: string,
  serverValue: boolean,
  overrides: Record<string, boolean>
): boolean {
  const override = overrides[flagKey];
  if (override !== undefined) {
    return override;
  }
  return serverValue;
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
