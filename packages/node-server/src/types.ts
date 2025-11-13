/**
 * Savvagent Node.js Server SDK Types
 */

/**
 * Configuration for initializing the FlagClient
 */
export interface FlagClientConfig {
  /** SDK API key (starts with sdk_) */
  apiKey: string;
  /** Application ID for application-scoped flags (omit for enterprise flags only) */
  applicationId?: string;
  /** Base URL for the Savvagent API (default: production URL) */
  baseUrl?: string;
  /** Enable real-time flag updates via SSE (default: true) */
  enableRealtime?: boolean;
  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  cacheTtl?: number;
  /** Enable telemetry tracking (default: true) */
  enableTelemetry?: boolean;
  /** Default flag values when evaluation fails */
  defaults?: Record<string, boolean>;
  /** Custom error handler */
  onError?: (error: Error) => void;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * Context passed to flag evaluation
 */
export interface FlagContext {
  /** User ID for targeted rollouts */
  user_id?: string;
  /** Session ID for session-based rollouts */
  session_id?: string;
  /** Application ID for application-scoped flags (auto-injected from config) */
  application_id?: string;
  /** Custom attributes for targeting rules */
  attributes?: Record<string, any>;
  /** Environment (dev, staging, production) */
  environment?: string;
  /** IP address for geo-targeting */
  ip_address?: string;
  /** User agent string */
  user_agent?: string;
}

/**
 * Result from flag evaluation
 */
export interface FlagEvaluationResult {
  /** Flag key */
  key: string;
  /** Evaluated value */
  value: boolean;
  /** Dynamic configuration attached to the flag (Phase 1) */
  configuration?: any;
  /** Variation identifier for multi-variant flags (Phase 2) */
  variation?: string;
  /** Reason for the value (cached, evaluated, default) */
  reason: 'cached' | 'evaluated' | 'default' | 'error';
  /** Metadata about the flag */
  metadata?: {
    flagId?: string;
    description?: string;
    variant?: string;
  };
}

/**
 * Telemetry event for flag evaluation
 */
export interface EvaluationEvent {
  flagKey: string;
  result: boolean;
  context?: FlagContext;
  durationMs: number;
  traceId?: string;
  timestamp: string;
}

/**
 * Telemetry event for errors in flagged code
 */
export interface ErrorEvent {
  flagKey: string;
  flagEnabled: boolean;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context?: FlagContext;
  traceId?: string;
  timestamp: string;
}

/**
 * Cache entry for flag values
 */
export interface CacheEntry {
  value: boolean;
  configuration?: any;
  variation?: string;
  expiresAt: number;
  flagId?: string;
}

/**
 * Real-time update event from SSE
 */
export interface FlagUpdateEvent {
  type: 'flag.updated' | 'flag.deleted' | 'flag.created';
  flagKey: string;
  data?: any;
}

/**
 * Options for setting configuration overrides
 */
export interface ConfigOverrideOptions {
  /** Merge with API configuration instead of replacing (default: false) */
  merge?: boolean;
  /** Validate configuration structure (default: true) */
  validate?: boolean;
}

/**
 * Internal structure for storing configuration overrides
 */
export interface ConfigOverrideEntry {
  /** Configuration override data */
  config: any;
  /** Whether to merge with API config */
  merge: boolean;
  /** Timestamp when override was set */
  timestamp: number;
}

/**
 * Internal structure for storing variation overrides
 */
export interface VariationOverrideEntry {
  /** Forced variation identifier */
  variation: string;
  /** Timestamp when override was set */
  timestamp: number;
}
