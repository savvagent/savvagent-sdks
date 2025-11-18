/**
 * Savvagent JavaScript/TypeScript SDK
 * AI-powered feature flags with automatic error detection
 */

export { FlagClient } from './client';
export { FlagCache } from './cache';
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
} from './types';

// Export generated API types for advanced users
export type { components } from './generated/api-types';

// Convenience type aliases for common API types
export type {
  components as ApiTypes,
} from './generated/api-types';
