import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { FlagClient, FlagClientConfig } from '@savvagent/sdk';

interface SavvagentContextValue {
  client: FlagClient | null;
  isReady: boolean;
}

const SavvagentContext = createContext<SavvagentContextValue>({
  client: null,
  isReady: false,
});

export interface SavvagentProviderProps {
  config: FlagClientConfig;
  children: React.ReactNode;
}

/**
 * Provider component that initializes and provides the Savvagent client
 * to all child components via React context.
 *
 * @example
 * ```tsx
 * <SavvagentProvider config={{ apiKey: 'sdk_...' }}>
 *   <App />
 * </SavvagentProvider>
 * ```
 */
export function SavvagentProvider({ config, children }: SavvagentProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const clientRef = useRef<FlagClient | null>(null);

  useEffect(() => {
    // Initialize client
    try {
      clientRef.current = new FlagClient(config);
      setIsReady(true);
    } catch (error) {
      console.error('[Savvagent] Failed to initialize client:', error);
      config.onError?.(error as Error);
    }

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.close();
        clientRef.current = null;
      }
    };
  }, [config.apiKey, config.baseUrl]); // Re-initialize if key/url changes

  return (
    <SavvagentContext.Provider value={{ client: clientRef.current, isReady }}>
      {children}
    </SavvagentContext.Provider>
  );
}

/**
 * Hook to access the Savvagent client instance.
 * Must be used within a SavvagentProvider.
 *
 * @returns The FlagClient instance and ready state
 * @throws Error if used outside of SavvagentProvider
 *
 * @example
 * ```tsx
 * const { client, isReady } = useSavvagent();
 *
 * if (!isReady) {
 *   return <div>Loading...</div>;
 * }
 *
 * const enabled = await client.isEnabled('my-feature');
 * ```
 */
export function useSavvagent(): SavvagentContextValue {
  const context = useContext(SavvagentContext);

  if (context === undefined) {
    throw new Error('useSavvagent must be used within a SavvagentProvider');
  }

  return context;
}
