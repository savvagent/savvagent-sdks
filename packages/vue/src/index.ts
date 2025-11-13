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

// Injection key for the Savvagent client
const SavvagentClientKey: InjectionKey<FlagClient> = Symbol('SavvagentClient');

/**
 * Vue plugin to install Savvagent globally.
 *
 * @param app - Vue app instance
 * @param config - Client configuration
 *
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { SavvagentPlugin } from '@savvagent/vue';
 *
 * const app = createApp(App);
 * app.use(SavvagentPlugin, {
 *   apiKey: 'sdk_...',
 *   applicationId: 'your-app-id',
 * });
 * ```
 */
export const SavvagentPlugin = {
  install(app: App, config: FlagClientConfig) {
    const client = new FlagClient(config);
    app.provide(SavvagentClientKey, client);

    // Cleanup on app unmount
    app.config.globalProperties.$savvagent = client;
  },
};

/**
 * Provide the Savvagent client to child components.
 * Alternative to using the plugin.
 *
 * @param config - Client configuration
 * @returns The FlagClient instance
 *
 * @example
 * ```vue
 * <script setup>
 * import { provideSavvagent } from '@savvagent/vue';
 *
 * provideSavvagent({
 *   apiKey: 'sdk_...',
 * });
 * </script>
 * ```
 */
export function provideSavvagent(config: FlagClientConfig): FlagClient {
  const client = new FlagClient(config);
  provide(SavvagentClientKey, client);
  return client;
}

/**
 * Get the Savvagent client instance.
 * Must be used within a component that has the plugin installed or provideSavvagent called.
 *
 * @returns The FlagClient instance
 * @throws Error if client is not provided
 *
 * @example
 * ```vue
 * <script setup>
 * import { useSavvagent } from '@savvagent/vue';
 *
 * const client = useSavvagent();
 * const enabled = await client.isEnabled('my-feature');
 * </script>
 * ```
 */
export function useSavvagent(): FlagClient {
  const client = inject(SavvagentClientKey);
  if (!client) {
    throw new Error(
      'Savvagent client not found. Use the SavvagentPlugin or provideSavvagent first.'
    );
  }
  return client;
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
  const client = useSavvagent();
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
    try {
      loading.value = true;
      error.value = null;

      const evalResult = await client.evaluate(flagKey, context);
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

  // Real-time updates
  onMounted(() => {
    if (!realtime) return;

    const unsubscribe = client.subscribe(flagKey, () => {
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

/**
 * Composable to manage user identification.
 *
 * @returns User ID management functions
 *
 * @example
 * ```vue
 * <script setup>
 * import { useUser } from '@savvagent/vue';
 * import { watch } from 'vue';
 *
 * const { setUserId } = useUser();
 *
 * watch(currentUser, (user) => {
 *   setUserId(user?.id || null);
 * });
 * </script>
 * ```
 */
export function useUser() {
  const client = useSavvagent();

  return {
    setUserId: (userId: string | null) => client.setUserId(userId),
    getUserId: () => client.getUserId(),
    getAnonymousId: () => client.getAnonymousId(),
    setAnonymousId: (id: string) => client.setAnonymousId(id),
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
  const client = useSavvagent();

  return (error: Error) => {
    client.trackError(flagKey, error, context);
  };
}

// Re-export types
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
