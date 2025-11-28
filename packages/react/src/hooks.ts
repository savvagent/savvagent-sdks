import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import { useSavvagent } from './context';

/**
 * Deep comparison for context objects to avoid unnecessary re-renders
 */
function useStableContext(context: FlagContext | undefined): FlagContext | undefined {
  const ref = useRef<FlagContext | undefined>(context);

  if (!deepEqual(ref.current, context)) {
    ref.current = context;
  }

  return ref.current;
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

export interface UseFlagOptions {
  /**
   * Context for flag evaluation (user_id, attributes, etc.)
   */
  context?: FlagContext;
  /**
   * Default value to use while loading or on error
   */
  defaultValue?: boolean;
  /**
   * Enable real-time updates for this flag
   */
  realtime?: boolean;
  /**
   * Custom error handler
   */
  onError?: (error: Error) => void;
}

export interface UseFlagResult {
  /**
   * Current flag value
   */
  value: boolean;
  /**
   * Whether the flag is currently being evaluated
   */
  loading: boolean;
  /**
   * Error if evaluation failed
   */
  error: Error | null;
  /**
   * Detailed evaluation result
   */
  result: FlagEvaluationResult | null;
  /**
   * Force re-evaluation of the flag
   */
  refetch: () => Promise<void>;
}

/**
 * Hook to evaluate a feature flag with automatic updates.
 *
 * @param flagKey - The feature flag key to evaluate
 * @param options - Configuration options
 * @returns Flag evaluation state and controls
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { value, loading } = useFlag('new-checkout', {
 *     context: { user_id: user?.id },
 *     defaultValue: false,
 *     realtime: true
 *   });
 *
 *   if (loading) return <Spinner />;
 *
 *   return value ? <NewCheckout /> : <OldCheckout />;
 * }
 * ```
 */
export function useFlag(
  flagKey: string,
  options: UseFlagOptions = {}
): UseFlagResult {
  const { client, isReady, defaultContext } = useSavvagent();
  const {
    context,
    defaultValue = false,
    realtime = true,
    onError,
  } = options;

  // Use refs for callbacks and values that shouldn't trigger re-evaluation
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;

  // Merge default context from provider with per-call context
  // Per-call context values override defaults
  const mergedContext = {
    ...defaultContext,
    ...context,
    // Deep merge attributes
    attributes: {
      ...defaultContext?.attributes,
      ...context?.attributes,
    },
  };

  // Use stable context reference to prevent infinite re-renders
  const stableContext = useStableContext(mergedContext);

  // Single state object for atomic updates - prevents multiple re-renders
  const [state, setState] = useState<{
    value: boolean;
    loading: boolean;
    error: Error | null;
    result: FlagEvaluationResult | null;
  }>({
    value: defaultValue,
    loading: true,
    error: null,
    result: null,
  });

  const evaluateFlag = useCallback(async () => {
    if (!client || !isReady) {
      return;
    }

    // Only set loading if not already loading (avoid unnecessary render)
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));

    try {
      const evalResult = await client.evaluate(flagKey, stableContext);
      // Single atomic state update
      setState({
        value: evalResult.value,
        loading: false,
        error: null,
        result: evalResult,
      });
    } catch (err) {
      const error = err as Error;
      onErrorRef.current?.(error);
      // Single atomic state update
      setState({
        value: defaultValueRef.current,
        loading: false,
        error,
        result: null,
      });
    }
  }, [client, isReady, flagKey, stableContext]);

  // Initial evaluation
  useEffect(() => {
    evaluateFlag();
  }, [evaluateFlag]);

  // Real-time updates
  useEffect(() => {
    if (!client || !isReady || !realtime) {
      return;
    }

    const unsubscribe = client.subscribe(flagKey, () => {
      // Flag updated, re-evaluate
      evaluateFlag();
    });

    return unsubscribe;
  }, [client, isReady, flagKey, realtime, evaluateFlag]);

  // Subscribe to override changes
  useEffect(() => {
    if (!client || !isReady) {
      return;
    }

    const unsubscribe = client.onOverrideChange(() => {
      // Override changed, re-evaluate
      evaluateFlag();
    });

    return unsubscribe;
  }, [client, isReady, evaluateFlag]);

  return {
    value: state.value,
    loading: state.loading,
    error: state.error,
    result: state.result,
    refetch: evaluateFlag,
  };
}

/**
 * Hook to execute a callback conditionally based on a flag value.
 *
 * @param flagKey - The feature flag key to check
 * @param callback - Function to execute if flag is enabled
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useWithFlag('analytics-enabled', async () => {
 *     await trackEvent('page_view');
 *   });
 *
 *   return <div>Content</div>;
 * }
 * ```
 */
export function useWithFlag(
  flagKey: string,
  callback: () => void | Promise<void>,
  options: UseFlagOptions = {}
): void {
  const { client, isReady } = useSavvagent();
  const { context } = options;

  useEffect(() => {
    if (!client || !isReady) {
      return;
    }

    client.withFlag(flagKey, callback, context).catch((error) => {
      console.error(`[Savvagent] Error in withFlag callback for ${flagKey}:`, error);
      options.onError?.(error);
    });
  }, [client, isReady, flagKey, callback, context, options]);
}

/**
 * Hook to get user identification methods.
 *
 * @returns User ID management functions
 *
 * @example
 * ```tsx
 * function AuthHandler() {
 *   const { setUserId, getUserId } = useUser();
 *
 *   useEffect(() => {
 *     if (user) {
 *       setUserId(user.id);
 *     } else {
 *       setUserId(null);
 *     }
 *   }, [user]);
 *
 *   return null;
 * }
 * ```
 */
export function useUser() {
  const { client } = useSavvagent();

  const setUserId = useCallback(
    (userId: string | null) => {
      client?.setUserId(userId);
    },
    [client]
  );

  const getUserId = useCallback(() => {
    return client?.getUserId() || null;
  }, [client]);

  const getAnonymousId = useCallback(() => {
    return client?.getAnonymousId() || null;
  }, [client]);

  const setAnonymousId = useCallback(
    (id: string) => {
      client?.setAnonymousId(id);
    },
    [client]
  );

  return {
    setUserId,
    getUserId,
    getAnonymousId,
    setAnonymousId,
  };
}

/**
 * Hook to track errors with flag context.
 *
 * @param flagKey - The feature flag key associated with errors
 * @param context - Optional context
 * @returns Error tracking function
 *
 * @example
 * ```tsx
 * function FeatureComponent() {
 *   const trackError = useTrackError('new-feature');
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
export function useTrackError(flagKey: string, context?: FlagContext) {
  const { client } = useSavvagent();

  return useCallback(
    (error: Error) => {
      if (client) {
        client.trackError(flagKey, error, context);
      }
    },
    [client, flagKey, context]
  );
}

export interface UseFlagsOptions {
  /**
   * Context for flag evaluation (user_id, attributes, etc.)
   */
  context?: FlagContext;
  /**
   * Default values for flags (keyed by flag key)
   */
  defaultValues?: Record<string, boolean>;
  /**
   * Enable real-time updates for these flags
   */
  realtime?: boolean;
  /**
   * Custom error handler
   */
  onError?: (error: Error, flagKey: string) => void;
}

export interface UseFlagsResult {
  /**
   * Map of flag keys to their current values
   */
  values: Record<string, boolean>;
  /**
   * Whether any flag is currently being evaluated
   */
  loading: boolean;
  /**
   * Map of flag keys to their errors (if any)
   */
  errors: Record<string, Error | null>;
  /**
   * Map of flag keys to their detailed evaluation results
   */
  results: Record<string, FlagEvaluationResult | null>;
  /**
   * Force re-evaluation of all flags
   */
  refetch: () => Promise<void>;
}

/**
 * Hook to evaluate multiple feature flags with a single subscription.
 * This is more efficient than using multiple useFlag hooks when you need
 * several flags in the same component, as it reduces re-render surface.
 *
 * @param flagKeys - Array of feature flag keys to evaluate
 * @param options - Configuration options
 * @returns Flag evaluation state and controls for all flags
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { values, loading } = useFlags(
 *     ['feature-a', 'feature-b', 'feature-c'],
 *     {
 *       context: { user_id: user?.id },
 *       defaultValues: { 'feature-a': false, 'feature-b': true },
 *       realtime: true
 *     }
 *   );
 *
 *   if (loading) return <Spinner />;
 *
 *   return (
 *     <div>
 *       {values['feature-a'] && <FeatureA />}
 *       {values['feature-b'] && <FeatureB />}
 *       {values['feature-c'] && <FeatureC />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFlags(
  flagKeys: string[],
  options: UseFlagsOptions = {}
): UseFlagsResult {
  const { client, isReady, defaultContext } = useSavvagent();
  const {
    context,
    defaultValues,
    realtime = true,
    onError,
  } = options;

  // Memoize flagKeys using a stable string key
  const flagKeysKey = flagKeys.join(',');
  const stableFlagKeys = useMemo(() => flagKeys, [flagKeysKey]);

  // Memoize defaultValues to prevent dependency changes
  const stableDefaultValues = useRef(defaultValues);
  stableDefaultValues.current = defaultValues;

  // Memoize onError to prevent dependency changes
  const stableOnError = useRef(onError);
  stableOnError.current = onError;

  // Merge default context from provider with per-call context
  const mergedContext = {
    ...defaultContext,
    ...context,
    attributes: {
      ...defaultContext?.attributes,
      ...context?.attributes,
    },
  };

  const stableContext = useStableContext(mergedContext);

  // Single state object for all flags - atomic updates
  const [state, setState] = useState<{
    values: Record<string, boolean>;
    loading: boolean;
    errors: Record<string, Error | null>;
    results: Record<string, FlagEvaluationResult | null>;
  }>(() => {
    const initialValues: Record<string, boolean> = {};
    const initialErrors: Record<string, Error | null> = {};
    const initialResults: Record<string, FlagEvaluationResult | null> = {};

    for (const key of flagKeys) {
      initialValues[key] = defaultValues?.[key] ?? false;
      initialErrors[key] = null;
      initialResults[key] = null;
    }

    return {
      values: initialValues,
      loading: true,
      errors: initialErrors,
      results: initialResults,
    };
  });

  const evaluateFlags = useCallback(async () => {
    if (!client || !isReady) {
      return;
    }

    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));

    const newValues: Record<string, boolean> = {};
    const newErrors: Record<string, Error | null> = {};
    const newResults: Record<string, FlagEvaluationResult | null> = {};

    // Evaluate all flags in parallel
    await Promise.all(
      stableFlagKeys.map(async (flagKey) => {
        try {
          const evalResult = await client.evaluate(flagKey, stableContext);
          newValues[flagKey] = evalResult.value;
          newErrors[flagKey] = null;
          newResults[flagKey] = evalResult;
        } catch (err) {
          const error = err as Error;
          newValues[flagKey] = stableDefaultValues.current?.[flagKey] ?? false;
          newErrors[flagKey] = error;
          newResults[flagKey] = null;
          stableOnError.current?.(error, flagKey);
        }
      })
    );

    // Single atomic state update for all flags
    setState({
      values: newValues,
      loading: false,
      errors: newErrors,
      results: newResults,
    });
  }, [client, isReady, stableFlagKeys, stableContext]);

  // Initial evaluation
  useEffect(() => {
    evaluateFlags();
  }, [evaluateFlags]);

  // Real-time updates - subscribe to all flags
  useEffect(() => {
    if (!client || !isReady || !realtime) {
      return;
    }

    const unsubscribes = stableFlagKeys.map((flagKey) =>
      client.subscribe(flagKey, () => {
        evaluateFlags();
      })
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [client, isReady, stableFlagKeys, realtime, evaluateFlags]);

  // Subscribe to override changes
  useEffect(() => {
    if (!client || !isReady) {
      return;
    }

    const unsubscribe = client.onOverrideChange(() => {
      // Override changed, re-evaluate all flags
      evaluateFlags();
    });

    return unsubscribe;
  }, [client, isReady, evaluateFlags]);

  return {
    values: state.values,
    loading: state.loading,
    errors: state.errors,
    results: state.results,
    refetch: evaluateFlags,
  };
}
