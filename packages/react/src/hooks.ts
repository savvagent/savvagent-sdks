import { useState, useEffect, useCallback } from 'react';
import { FlagContext, FlagEvaluationResult } from '@savvagent/sdk';
import { useSavvagent } from './context';

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
  const { client, isReady } = useSavvagent();
  const {
    context,
    defaultValue = false,
    realtime = true,
    onError,
  } = options;

  const [value, setValue] = useState<boolean>(defaultValue);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<FlagEvaluationResult | null>(null);

  const evaluateFlag = useCallback(async () => {
    if (!client || !isReady) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const evalResult = await client.evaluate(flagKey, context);
      setValue(evalResult.value);
      setResult(evalResult);
    } catch (err) {
      const error = err as Error;
      setError(error);
      setValue(defaultValue);
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [client, isReady, flagKey, context, defaultValue, onError]);

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

  return {
    value,
    loading,
    error,
    result,
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
