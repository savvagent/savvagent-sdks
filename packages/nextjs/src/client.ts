/**
 * Client-side exports for Next.js Client Components
 * Use these in components marked with 'use client' directive
 */

'use client';

// Re-export all client-side functionality from React SDK
export {
  SavvagentProvider,
  useSavvagent,
  useFlag,
  useWithFlag,
  useUser,
  useTrackError,
} from '@savvagent/react';

export type {
  SavvagentProviderProps,
  UseFlagOptions,
  UseFlagResult,
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
} from '@savvagent/react';
