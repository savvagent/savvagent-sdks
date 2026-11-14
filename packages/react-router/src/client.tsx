/**
 * Client side: the @savvagent/react provider and hooks, plus hydration of
 * flags evaluated on the server so the first render shows real values.
 */

import { createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  SavvagentProvider as ReactSavvagentProvider,
  useFlag as useReactFlag,
  useFlags as useReactFlags,
  useSavvagent,
} from '@savvagent/react';
import type {
  SavvagentProviderProps as ReactSavvagentProviderProps,
  UseFlagOptions,
  UseFlagResult,
  UseFlagsOptions,
  UseFlagsResult,
} from '@savvagent/react';
import type { FlagClient, FlagEvaluationResult } from '@savvagent/sdk';
import type { SavvagentFlags } from './server';

const EMPTY_FLAGS: SavvagentFlags = {};
const HydratedFlagsContext = createContext<SavvagentFlags>(EMPTY_FLAGS);

export interface SavvagentProviderProps extends ReactSavvagentProviderProps {
  /**
   * Flags evaluated on the server (from `evaluateFlags` in a loader). The hooks
   * return these values until the browser client has evaluated the flags
   * itself, so server rendering and hydration show them instead of defaults.
   */
  flags?: SavvagentFlags | null;
  children: ReactNode;
}

/**
 * The `@savvagent/react` provider, with server-evaluated flags for hydration.
 *
 * @example
 * ```tsx
 * // app/root.tsx
 * export default function App({ loaderData }: Route.ComponentProps) {
 *   return (
 *     <SavvagentProvider config={config} flags={loaderData.flags}>
 *       <Outlet />
 *     </SavvagentProvider>
 *   );
 * }
 * ```
 */
export function SavvagentProvider({ flags, children, ...props }: SavvagentProviderProps) {
  return (
    <HydratedFlagsContext.Provider value={flags ?? EMPTY_FLAGS}>
      <ReactSavvagentProvider {...props}>{children}</ReactSavvagentProvider>
    </HydratedFlagsContext.Provider>
  );
}

/** The server-evaluated flags passed to the nearest `SavvagentProvider`. */
export function useHydratedFlags(): SavvagentFlags {
  return useContext(HydratedFlagsContext);
}

/** A server result usable for hydration: one the server actually resolved. */
function hydratable(result: FlagEvaluationResult | undefined): result is FlagEvaluationResult {
  return !!result && result.reason !== 'error';
}

/**
 * The hydrated result, unless the browser client already holds a local
 * override for the flag: overrides win, as they do in `client.evaluate`.
 * Before the client exists (server render, hydration) this is the server's.
 */
function withOverride(
  client: FlagClient | null,
  flagKey: string,
  result: FlagEvaluationResult
): FlagEvaluationResult {
  const override = client?.getOverride(flagKey);
  if (override === undefined) return result;
  return { key: flagKey, value: override, reason: 'default', metadata: { description: 'Local override active' } };
}

/**
 * True once the live hook has finished its first evaluation. From then on its
 * own values (with overrides and realtime updates) are returned.
 */
function useResolvedOnce(loading: boolean): boolean {
  const resolved = useRef(false);
  if (!loading) resolved.current = true;
  return resolved.current;
}

/**
 * `useFlag` from `@savvagent/react`, starting from the server's value when the
 * flag was hydrated through `<SavvagentProvider flags>`.
 */
export function useFlag(flagKey: string, options: UseFlagOptions = {}): UseFlagResult {
  const live = useReactFlag(flagKey, options);
  const { client } = useSavvagent();
  const hydrated = useHydratedFlags()[flagKey];
  const resolved = useResolvedOnce(live.loading);

  if (resolved || !hydratable(hydrated)) return live;
  const result = withOverride(client, flagKey, hydrated);
  return { ...live, value: result.value, loading: false, error: null, result };
}

/**
 * `useFlags` from `@savvagent/react`, starting from the server's values when
 * every requested flag was hydrated through `<SavvagentProvider flags>`.
 */
export function useFlags(flagKeys: string[], options: UseFlagsOptions = {}): UseFlagsResult {
  const live = useReactFlags(flagKeys, options);
  const { client } = useSavvagent();
  const hydrated = useHydratedFlags();
  const resolved = useResolvedOnce(live.loading);

  if (resolved || !flagKeys.every((key) => hydratable(hydrated[key]))) return live;

  const values: Record<string, boolean> = {};
  const errors: Record<string, Error | null> = {};
  const results: Record<string, FlagEvaluationResult | null> = {};
  for (const key of flagKeys) {
    const result = withOverride(client, key, hydrated[key]);
    values[key] = result.value;
    errors[key] = null;
    results[key] = result;
  }
  return { ...live, values, loading: false, errors, results };
}
