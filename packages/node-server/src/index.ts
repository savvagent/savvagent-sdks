/**
 * Savvagent Node.js Server SDK
 * AI-powered feature flags for Node.js backend applications
 */

export { FlagClient } from './client';
export { FlagCache, contextCacheKey, DEFAULT_CACHE_MAX_ENTRIES } from './cache';
export { defaultFromEnv } from './defaults';
export { TelemetryService } from './telemetry';
export { RealtimeService } from './realtime';

export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  EvaluationEvent,
  ErrorEvent,
  CacheEntry,
  FlagUpdateEvent,
  FlagDefinition,
  FlagListResponse,
} from './types';

// Re-export generated API types from the main SDK for advanced users
export type { components, components as ApiTypes } from '@savvagent/sdk';
