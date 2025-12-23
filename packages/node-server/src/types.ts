/**
 * Savvagent Node.js Server SDK Types
 */

/**
 * Configuration for initializing the FlagClient
 * Per SDK Developer Guide: https://docs.savvagent.com/sdk-developer-guide
 */
export interface FlagClientConfig {
  /**
   * API key for authentication
   * - SDK keys (sdk_) - Safe for client-side apps (browsers, mobile)
   * - Server keys (srv_) - Secret, for server-side apps only (Node.js, Python)
   * Per SDK Developer Guide: Server keys should never be exposed in client-side code
   */
  apiKey: string;
  /** Application ID for application-scoped flags (omit for enterprise flags only) */
  applicationId?: string;
  /** Base URL for the Savvagent API (default: production URL) */
  baseUrl?: string;
  /** Environment for flag evaluation (e.g., "development", "staging", "production", "beta"). Default: "production" */
  environment?: string;
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
 * Per SDK Developer Guide: https://docs.savvagent.com/sdk-developer-guide
 */
export interface FlagContext {
  /** User ID for targeted rollouts (logged-in users) - required for percentage rollouts */
  user_id?: string;
  /** Anonymous ID for consistent rollouts (anonymous users) - alternative to user_id */
  anonymous_id?: string;
  /** Session ID as fallback identifier */
  session_id?: string;
  /** Target environment (e.g., "production", "staging") */
  environment?: string;
  /** Organization ID for multi-tenant apps */
  organization_id?: string;
  /** Application ID for hierarchical flag lookup (auto-injected from config) */
  application_id?: string;
  /** User's language code (e.g., "en", "es") */
  language?: string;
  /** Custom attributes for targeting rules */
  attributes?: Record<string, any>;
  /** IP address for geo-targeting (server-side only) */
  ip_address?: string;
  /** User agent string (server-side only) */
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

/**
 * Flag definition returned from getAllFlags endpoint
 * Per SDK Developer Guide: GET /api/sdk/flags
 */
export interface FlagDefinition {
  /** Flag key */
  key: string;
  /** Enabled state for the requested environment */
  enabled: boolean;
  /** Flag scope: "application" or "enterprise" */
  scope: 'application' | 'enterprise';
  /** Environment configuration with enabled state and rollout percentage */
  environments: Record<string, { enabled: boolean; rollout_percentage?: number }>;
  /** Variation definitions for A/B testing (if any) */
  variations?: Record<string, any> | null;
  /** Dynamic configuration attached to the flag */
  configuration?: any;
  /** Flag version for cache invalidation */
  version: number;
}

/**
 * Response from getAllFlags endpoint
 * Per SDK Developer Guide: GET /api/sdk/flags
 */
export interface FlagListResponse {
  /** List of flag definitions */
  flags: FlagDefinition[];
  /** Total count of flags returned */
  count: number;
  /** Organization ID */
  organization_id: string;
  /** Application ID (present for SDK key auth) */
  application_id?: string;
}
