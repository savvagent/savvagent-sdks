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
  createMemo,
  onCleanup,
  type Accessor,
  type ParentProps,
} from 'solid-js';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult } from '@savvagent/sdk';

/**
 * Default context values that apply to all flag evaluations
 * Per SDK Developer Guide: https://docs.savvagent.com/sdk-developer-guide
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
  attributes?: Record<string, any>;
}

interface SavvagentContextValue {
  client: FlagClient;
  isReady: Accessor<boolean>;
  defaultContext: Accessor<FlagContext>;
}

const SavvagentContext = createContext<SavvagentContextValue>();

export interface SavvagentProviderProps extends ParentProps {
  config: FlagClientConfig;
  /** Default context values applied to all flag evaluations */
  defaultContext?: DefaultFlagContext;
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
 *     <SavvagentProvider
 *       config={{ apiKey: 'sdk_...' }}
 *       defaultContext={{
 *         applicationId: 'my-app-id',
 *         environment: 'development',
 *         userId: 'user-123',
 *         attributes: { plan: 'pro' }
 *       }}
 *     >
 *       <MyApp />
 *     </SavvagentProvider>
 *   );
 * }
 * ```
 */
export function SavvagentProvider(props: SavvagentProviderProps) {
  const [isReady, setIsReady] = createSignal(false);

  // Initialize client
  let client: FlagClient;
  try {
    client = new FlagClient(props.config);
    setIsReady(true);
  } catch (error) {
    console.error('[Savvagent] Failed to initialize client:', error);
    props.config.onError?.(error as Error);
    // Create a non-functional client to prevent crashes
    client = new FlagClient({ ...props.config, apiKey: '' });
  }

  // Convert DefaultFlagContext to FlagContext format (camelCase to snake_case)
  const normalizedDefaultContext = createMemo<FlagContext>(() => ({
    application_id: props.defaultContext?.applicationId,
    environment: props.defaultContext?.environment,
    organization_id: props.defaultContext?.organizationId,
    user_id: props.defaultContext?.userId,
    anonymous_id: props.defaultContext?.anonymousId,
    session_id: props.defaultContext?.sessionId,
    language: props.defaultContext?.language,
    attributes: props.defaultContext?.attributes,
  }));

  onCleanup(() => {
    client.close();
  });

  const contextValue: SavvagentContextValue = {
    client,
    isReady,
    defaultContext: normalizedDefaultContext,
  };

  return (
    <SavvagentContext.Provider value={contextValue}>
      {props.children}
    </SavvagentContext.Provider>
  );
}

/**
 * Get the Savvagent context including client, ready state, and default context.
 * Must be used within a SavvagentProvider.
 *
 * @returns The FlagClient instance, ready state accessor, and default context accessor
 * @throws Error if used outside of SavvagentProvider
 *
 * @example
 * ```tsx
 * import { useSavvagent } from '@savvagent/solid';
 *
 * function MyComponent() {
 *   const { client, isReady, defaultContext } = useSavvagent();
 *
 *   return (
 *     <Show when={isReady()}>
 *       <div>Client ready!</div>
 *     </Show>
 *   );
 * }
 * ```
 */
export function useSavvagent(): SavvagentContextValue {
  const context = useContext(SavvagentContext);
  if (!context) {
    throw new Error('useSavvagent must be used within a SavvagentProvider');
  }
  return context;
}

/**
 * Simple deep equality check for context objects
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }

  return true;
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
  const { client, isReady, defaultContext } = useSavvagent();
  const {
    context,
    defaultValue = false,
    realtime = true,
    onError,
  } = options;

  const [trigger, setTrigger] = createSignal(0);

  // Merge default context with per-call context
  const mergedContext = createMemo(() => {
    const def = defaultContext();
    return {
      ...def,
      ...context,
      attributes: {
        ...def?.attributes,
        ...context?.attributes,
      },
    };
  });

  // Track previous context for comparison
  let prevContext: FlagContext | undefined;

  const [result] = createResource(
    () => ({ trigger: trigger(), context: mergedContext(), ready: isReady() }),
    async (source) => {
      if (!source.ready) {
        return null;
      }

      try {
        return await client.evaluate(flagKey, source.context);
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
    if (!realtime || !isReady()) return;

    const unsubscribe = client.subscribe(flagKey, () => {
      setTrigger((t) => t + 1);
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  // Subscribe to override changes
  createEffect(() => {
    if (!isReady()) return;

    const unsubscribe = client.onOverrideChange(() => {
      setTrigger((t) => t + 1);
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  // Re-evaluate when context changes
  createEffect(() => {
    const currentContext = mergedContext();
    if (prevContext !== undefined && !deepEqual(prevContext, currentContext)) {
      setTrigger((t) => t + 1);
    }
    prevContext = currentContext;
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

export interface CreateFlagsOptions {
  /** Context for flag evaluation */
  context?: FlagContext;
  /** Default values for flags (keyed by flag key) */
  defaultValues?: Record<string, boolean>;
  /** Enable real-time updates */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error, flagKey: string) => void;
}

export interface CreateFlagsReturn {
  /** Map of flag keys to their current values */
  values: Accessor<Record<string, boolean>>;
  /** Whether any flag is currently being evaluated */
  loading: Accessor<boolean>;
  /** Map of flag keys to their errors (if any) */
  errors: Accessor<Record<string, Error | null>>;
  /** Map of flag keys to their detailed evaluation results */
  results: Accessor<Record<string, FlagEvaluationResult | null>>;
  /** Force re-evaluation of all flags */
  refetch: () => void;
}

/**
 * Create reactive flags for multiple flag keys with a single state update.
 * This is more efficient than using multiple createFlag calls when you need
 * several flags in the same component.
 *
 * @param flagKeys - Array of feature flag keys to evaluate
 * @param options - Configuration options
 * @returns Reactive flag state for all flags
 *
 * @example
 * ```tsx
 * import { createFlags } from '@savvagent/solid';
 * import { Show, For } from 'solid-js';
 *
 * function MyComponent() {
 *   const flags = createFlags(
 *     ['feature-a', 'feature-b', 'feature-c'],
 *     {
 *       context: { user_id: 'user-123' },
 *       defaultValues: { 'feature-a': false, 'feature-b': true },
 *       realtime: true
 *     }
 *   );
 *
 *   return (
 *     <Show when={!flags.loading()} fallback={<Spinner />}>
 *       <div>
 *         <Show when={flags.values()['feature-a']}>
 *           <FeatureA />
 *         </Show>
 *         <Show when={flags.values()['feature-b']}>
 *           <FeatureB />
 *         </Show>
 *       </div>
 *     </Show>
 *   );
 * }
 * ```
 */
export function createFlags(
  flagKeys: string[],
  options: CreateFlagsOptions = {}
): CreateFlagsReturn {
  const { client, isReady, defaultContext } = useSavvagent();
  const {
    context,
    defaultValues = {},
    realtime = true,
    onError,
  } = options;

  const [trigger, setTrigger] = createSignal(0);

  // Merge default context with per-call context
  const mergedContext = createMemo(() => {
    const def = defaultContext();
    return {
      ...def,
      ...context,
      attributes: {
        ...def?.attributes,
        ...context?.attributes,
      },
    };
  });

  // Initialize state with default values
  const initialValues: Record<string, boolean> = {};
  const initialErrors: Record<string, Error | null> = {};
  const initialResults: Record<string, FlagEvaluationResult | null> = {};

  for (const key of flagKeys) {
    initialValues[key] = defaultValues[key] ?? false;
    initialErrors[key] = null;
    initialResults[key] = null;
  }

  const [values, setValues] = createSignal<Record<string, boolean>>(initialValues);
  const [errors, setErrors] = createSignal<Record<string, Error | null>>(initialErrors);
  const [results, setResults] = createSignal<Record<string, FlagEvaluationResult | null>>(initialResults);
  const [loading, setLoading] = createSignal(true);

  // Track previous context for comparison
  let prevContext: FlagContext | undefined;

  // Evaluate all flags
  const evaluateFlags = async () => {
    if (!isReady()) return;

    setLoading(true);

    const newValues: Record<string, boolean> = {};
    const newErrors: Record<string, Error | null> = {};
    const newResults: Record<string, FlagEvaluationResult | null> = {};

    const ctx = mergedContext();

    // Evaluate all flags in parallel
    await Promise.all(
      flagKeys.map(async (flagKey) => {
        try {
          const evalResult = await client.evaluate(flagKey, ctx);
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
    setValues(newValues);
    setErrors(newErrors);
    setResults(newResults);
    setLoading(false);
  };

  // Initial evaluation and re-evaluate on trigger change
  createEffect(() => {
    // Access trigger to track it
    trigger();
    if (isReady()) {
      evaluateFlags();
    }
  });

  // Real-time updates - subscribe to all flags
  createEffect(() => {
    if (!realtime || !isReady()) return;

    const unsubscribes = flagKeys.map((flagKey) =>
      client.subscribe(flagKey, () => {
        setTrigger((t) => t + 1);
      })
    );

    onCleanup(() => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    });
  });

  // Subscribe to override changes
  createEffect(() => {
    if (!isReady()) return;

    const unsubscribe = client.onOverrideChange(() => {
      setTrigger((t) => t + 1);
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  // Re-evaluate when context changes
  createEffect(() => {
    const currentContext = mergedContext();
    if (prevContext !== undefined && !deepEqual(prevContext, currentContext)) {
      setTrigger((t) => t + 1);
    }
    prevContext = currentContext;
  });

  return {
    values,
    loading,
    errors,
    results,
    refetch: () => setTrigger((t) => t + 1),
  };
}

/**
 * Execute a callback conditionally based on a flag value.
 *
 * @param flagKey - The feature flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * import { createWithFlag } from '@savvagent/solid';
 *
 * function MyComponent() {
 *   createWithFlag('analytics-enabled', async () => {
 *     await trackEvent('page_view');
 *   });
 *
 *   return <div>Content</div>;
 * }
 * ```
 */
export function createWithFlag(
  flagKey: string,
  callback: () => void | Promise<void>,
  options: CreateFlagOptions = {}
): void {
  const { client, isReady } = useSavvagent();
  const { context, onError } = options;

  createEffect(() => {
    if (!isReady()) return;

    client.withFlag(flagKey, callback, context).catch((error) => {
      console.error(`[Savvagent] Error in withFlag callback for ${flagKey}:`, error);
      onError?.(error);
    });
  });
}

export interface CreateUserReturn {
  /** Current user ID */
  userId: Accessor<string | null>;
  /** Set user ID */
  setUserId: (id: string | null) => void;
  /** Get current user ID from client */
  getUserId: () => string | null;
  /** Current anonymous ID */
  anonymousId: Accessor<string | null>;
  /** Set anonymous ID */
  setAnonymousId: (id: string) => void;
  /** Get current anonymous ID from client */
  getAnonymousId: () => string | null;
}

/**
 * Create signals for user identification management.
 *
 * @returns User ID management functions and reactive signals
 *
 * @example
 * ```tsx
 * import { createUser } from '@savvagent/solid';
 * import { createEffect } from 'solid-js';
 *
 * function AuthHandler() {
 *   const user = createUser();
 *
 *   createEffect(() => {
 *     if (currentUser()) {
 *       user.setUserId(currentUser().id);
 *     } else {
 *       user.setUserId(null);
 *     }
 *   });
 *
 *   return <div>User ID: {user.userId()}</div>;
 * }
 * ```
 */
export function createUser(): CreateUserReturn {
  const { client } = useSavvagent();
  const [userId, setUserIdSignal] = createSignal<string | null>(client.getUserId());
  const [anonymousId, setAnonymousIdSignal] = createSignal<string | null>(client.getAnonymousId());

  const setUserId = (id: string | null) => {
    client.setUserId(id);
    setUserIdSignal(id);
  };

  const getUserId = () => {
    return client.getUserId();
  };

  const setAnonymousId = (id: string) => {
    client.setAnonymousId(id);
    setAnonymousIdSignal(id);
  };

  const getAnonymousId = () => {
    return client.getAnonymousId();
  };

  return {
    userId,
    setUserId,
    getUserId,
    anonymousId,
    setAnonymousId,
    getAnonymousId,
  };
}

export interface CreateEnvironmentReturn {
  /** Current environment as a reactive signal */
  environment: Accessor<string>;
  /** Set the environment */
  setEnvironment: (env: string) => void;
  /** Get the current environment from client */
  getEnvironment: () => string;
}

/**
 * Create signals for environment management.
 *
 * @returns Environment management functions and reactive signal
 *
 * @example
 * ```tsx
 * import { createEnvironment } from '@savvagent/solid';
 *
 * function EnvironmentSwitcher() {
 *   const { environment, setEnvironment } = createEnvironment();
 *
 *   return (
 *     <select value={environment()} onChange={(e) => setEnvironment(e.target.value)}>
 *       <option value="development">Development</option>
 *       <option value="staging">Staging</option>
 *       <option value="production">Production</option>
 *     </select>
 *   );
 * }
 * ```
 */
export function createEnvironment(): CreateEnvironmentReturn {
  const { client } = useSavvagent();
  const [environment, setEnvironmentSignal] = createSignal<string>(client.getEnvironment());

  const setEnvironment = (env: string) => {
    client.setEnvironment(env);
    setEnvironmentSignal(env);
  };

  const getEnvironment = () => {
    return client.getEnvironment();
  };

  return {
    environment,
    setEnvironment,
    getEnvironment,
  };
}

/**
 * Legacy function - use createUser() instead.
 * Create signals for user identification.
 *
 * @returns User ID signal tuple [userId, setUserId]
 * @deprecated Use createUser() for full user management
 *
 * @example
 * ```tsx
 * import { createUserSignals } from '@savvagent/solid';
 *
 * function AuthHandler() {
 *   const [userId, setUserId] = createUserSignals();
 *
 *   return <div>User ID: {userId()}</div>;
 * }
 * ```
 */
export function createUserSignals() {
  const { client } = useSavvagent();
  const [userId, setUserIdSignal] = createSignal<string | null>(client.getUserId());

  const setUserId = (id: string | null) => {
    client.setUserId(id);
    setUserIdSignal(id);
  };

  return [userId, setUserId] as const;
}

/**
 * Create an error tracking function for a specific flag.
 *
 * @param flagKey - The flag key associated with errors
 * @param context - Optional context
 * @returns Error tracking function
 *
 * @example
 * ```tsx
 * import { createTrackError } from '@savvagent/solid';
 *
 * function FeatureComponent() {
 *   const trackError = createTrackError('new-feature');
 *
 *   const handleAction = async () => {
 *     try {
 *       await doSomething();
 *     } catch (error) {
 *       trackError(error as Error);
 *     }
 *   };
 *
 *   return <button onClick={handleAction}>Try Feature</button>;
 * }
 * ```
 */
export function createTrackError(flagKey: string, context?: FlagContext) {
  const { client } = useSavvagent();

  return (error: Error) => {
    client.trackError(flagKey, error, context);
  };
}

/**
 * Track an error with flag context.
 * Direct function call (not reactive).
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
  const { client } = useSavvagent();
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
