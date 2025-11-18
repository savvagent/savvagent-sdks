/**
 * @savvagent/solid - SolidJS SDK for Savvagent feature flags
 *
 * Provides SolidJS reactive primitives for feature flag evaluation.
 *
 * @packageDocumentation
 */

import {
  createContext,
  useContext,
  createSignal,
  createResource,
  createEffect,
  onCleanup,
  type Accessor,
  type ParentProps,
} from 'solid-js';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

const SavvagentContext = createContext<FlagClient>();

export interface SavvagentProviderProps extends ParentProps {
  config: FlagClientConfig;
}

/**
 * Provider component that initializes and provides the Savvagent client.
 *
 * @example
 * ```tsx
 * import { SavvagentProvider } from '@savvagent/solid';
 *
 * function App() {
 *   return (
 *     <SavvagentProvider config={{ apiKey: 'sdk_...' }}>
 *       <MyApp />
 *     </SavvagentProvider>
 *   );
 * }
 * ```
 */
export function SavvagentProvider(props: SavvagentProviderProps) {
  const client = new FlagClient(props.config);

  onCleanup(() => {
    client.close();
  });

  return (
    <SavvagentContext.Provider value={client}>
      {props.children}
    </SavvagentContext.Provider>
  );
}

/**
 * Get the Savvagent client instance.
 * Must be used within a SavvagentProvider.
 *
 * @returns The FlagClient instance
 * @throws Error if used outside of SavvagentProvider
 *
 * @example
 * ```tsx
 * import { useSavvagent } from '@savvagent/solid';
 *
 * function MyComponent() {
 *   const client = useSavvagent();
 *   const enabled = await client.isEnabled('my-feature');
 *   return <div>Enabled: {enabled}</div>;
 * }
 * ```
 */
export function useSavvagent(): FlagClient {
  const client = useContext(SavvagentContext);
  if (!client) {
    throw new Error('useSavvagent must be used within a SavvagentProvider');
  }
  return client;
}

export interface CreateFlagOptions {
  /** Context for flag evaluation */
  context?: FlagContext;
  /** Default value while loading or on error */
  defaultValue?: boolean;
  /** Enable real-time updates */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => void;
}

export interface CreateFlagReturn {
  /** Current flag value */
  value: Accessor<boolean>;
  /** Whether the flag is loading */
  loading: Accessor<boolean>;
  /** Error if evaluation failed */
  error: Accessor<Error | null>;
  /** Detailed evaluation result */
  result: Accessor<FlagEvaluationResult | null>;
  /** Force re-evaluation */
  refetch: () => void;
}

/**
 * Create a reactive flag with automatic updates.
 *
 * @param flagKey - The feature flag key
 * @param options - Configuration options
 * @returns Reactive flag state
 *
 * @example
 * ```tsx
 * import { createFlag } from '@savvagent/solid';
 * import { Show } from 'solid-js';
 *
 * function MyComponent() {
 *   const flag = createFlag('new-feature', {
 *     context: { user_id: userId() },
 *     defaultValue: false,
 *     realtime: true,
 *   });
 *
 *   return (
 *     <Show when={!flag.loading()} fallback={<div>Loading...</div>}>
 *       <Show when={flag.value()} fallback={<OldFeature />}>
 *         <NewFeature />
 *       </Show>
 *     </Show>
 *   );
 * }
 * ```
 */
export function createFlag(
  flagKey: string,
  options: CreateFlagOptions = {}
): CreateFlagReturn {
  const client = useSavvagent();
  const {
    context,
    defaultValue = false,
    realtime = true,
    onError,
  } = options;

  const [trigger, setTrigger] = createSignal(0);

  const [result] = createResource(
    trigger,
    async () => {
      try {
        return await client.evaluate(flagKey, context);
      } catch (err) {
        const error = err as Error;
        onError?.(error);
        throw error;
      }
    }
  );

  const value = () => result()?.value ?? defaultValue;
  const loading = () => result.loading;
  const error = () => result.error ?? null;

  // Real-time updates
  createEffect(() => {
    if (!realtime) return;

    const unsubscribe = client.subscribe(flagKey, () => {
      setTrigger((t) => t + 1);
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  return {
    value,
    loading,
    error,
    result: () => result() ?? null,
    refetch: () => setTrigger((t) => t + 1),
  };
}

/**
 * Create a simple reactive flag that returns only the boolean value.
 *
 * @param flagKey - The feature flag key
 * @param options - Configuration options
 * @returns Accessor for flag value
 *
 * @example
 * ```tsx
 * import { createFlagValue } from '@savvagent/solid';
 * import { Show } from 'solid-js';
 *
 * function MyComponent() {
 *   const isEnabled = createFlagValue('new-feature');
 *
 *   return (
 *     <Show when={isEnabled()}>
 *       <NewFeature />
 *     </Show>
 *   );
 * }
 * ```
 */
export function createFlagValue(
  flagKey: string,
  options: CreateFlagOptions = {}
): Accessor<boolean> {
  const flag = createFlag(flagKey, options);
  return flag.value;
}

/**
 * Create signals for user identification.
 *
 * @returns User ID management functions
 *
 * @example
 * ```tsx
 * import { createUserSignals } from '@savvagent/solid';
 * import { createEffect } from 'solid-js';
 *
 * function AuthHandler() {
 *   const [userId, setUserId] = createUserSignals();
 *
 *   createEffect(() => {
 *     if (currentUser()) {
 *       setUserId(currentUser().id);
 *     } else {
 *       setUserId(null);
 *     }
 *   });
 *
 *   return null;
 * }
 * ```
 */
export function createUserSignals() {
  const client = useSavvagent();
  const [userId, setUserIdSignal] = createSignal<string | null>(client.getUserId());

  const setUserId = (id: string | null) => {
    client.setUserId(id);
    setUserIdSignal(id);
  };

  return [userId, setUserId] as const;
}

/**
 * Track an error with flag context.
 *
 * @param flagKey - The flag key associated with the error
 * @param error - The error that occurred
 * @param context - Optional context
 *
 * @example
 * ```tsx
 * import { trackError } from '@savvagent/solid';
 *
 * function MyComponent() {
 *   const handleAction = async () => {
 *     try {
 *       await doSomething();
 *     } catch (error) {
 *       trackError('new-feature', error as Error);
 *     }
 *   };
 *
 *   return <button onClick={handleAction}>Try Feature</button>;
 * }
 * ```
 */
export function trackError(
  flagKey: string,
  error: Error,
  context?: FlagContext
): void {
  const client = useSavvagent();
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
