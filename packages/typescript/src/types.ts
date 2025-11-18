/**
 * Savvagent SDK Types
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
  /** Default language for targeting (overrides browser detection) */
  defaultLanguage?: string;
  /** Disable automatic browser language detection (default: false) */
  disableLanguageDetection?: boolean;
}

/**
 * Context passed to flag evaluation
 */
export interface FlagContext {
  /** User ID for targeted rollouts (logged-in users) */
  user_id?: string;
  /** Anonymous ID for consistent rollouts (anonymous users) */
  anonymous_id?: string;
  /** Session ID as fallback identifier */
  session_id?: string;
  /** Application ID for application-scoped flags (auto-injected from config) */
  application_id?: string;
  /** User's language for language targeting (BCP 47 format, e.g., "en", "en-US") */
  language?: string;
  /** Custom attributes for targeting rules */
  attributes?: Record<string, any>;
  /** Environment (dev, staging, production) */
  environment?: string;
}

/**
 * Result from flag evaluation
 */
export interface FlagEvaluationResult {
  /** Flag key */
  key: string;
  /** Evaluated value */
  value: boolean;
  /** Reason for the value (cached, evaluated, default) */
  reason: 'cached' | 'evaluated' | 'default' | 'error';
  /** Metadata about the flag */
  metadata?: {
    flagId?: string;
    description?: string;
    scope?: string | null;
    configuration?: any;
    variation?: string | null;
    timestamp?: number;
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
