import { FlagCache } from './cache';
import { TelemetryService } from './telemetry';
import { RealtimeService } from './realtime';
import {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  FlagDefinition,
  FlagListResponse,
} from './types';
import { components } from './generated/api-types';

// Type aliases for generated API types
type ApiEvaluateRequest = components['schemas']['EvaluateFlag'];
type ApiEvaluateResponse = components['schemas']['FlagEvaluationResponse'];

/**
 * Savvagent Client for feature flag evaluation with AI-powered error detection
 */
export class FlagClient {
  private config: Required<FlagClientConfig>;
  private cache: FlagCache;
  private telemetry: TelemetryService;
  private realtime: RealtimeService | null = null;
  private anonymousId: string | null = null;
  private userId: string | null = null;
  private detectedLanguage: string | null = null;
  private overrides: Map<string, boolean> = new Map();
  private overrideListeners: Set<() => void> = new Set();
  private authFailed: boolean = false; // Track auth failures to prevent request spam

  constructor(config: FlagClientConfig) {
    // Apply defaults
    this.config = {
      apiKey: config.apiKey,
      applicationId: config.applicationId || '',
      baseUrl: config.baseUrl || 'http://localhost:8080',
      environment: config.environment || 'production',
      enableRealtime: config.enableRealtime ?? true,
      cacheTtl: config.cacheTtl || 60000,
      enableTelemetry: config.enableTelemetry ?? true,
      defaults: config.defaults || {},
      onError: config.onError || ((error) => console.error('[Savvagent]', error)),
      defaultLanguage: config.defaultLanguage || '',
      disableLanguageDetection: config.disableLanguageDetection ?? false,
    };

    // Auto-detect browser language if not disabled
    if (!this.config.disableLanguageDetection && typeof navigator !== 'undefined') {
      this.detectedLanguage = this.config.defaultLanguage ||
        navigator.language ||
        (navigator as any).userLanguage ||
        null;
    }

    // Validate API key
    if (!this.config.apiKey || !this.config.apiKey.startsWith('sdk_')) {
      throw new Error('Invalid API key. SDK keys must start with "sdk_"');
    }

    // Initialize services
    this.cache = new FlagCache(this.config.cacheTtl);
    this.telemetry = new TelemetryService(
      this.config.baseUrl,
      this.config.apiKey,
      this.config.enableTelemetry
    );

    // Initialize real-time updates
    // Uses @microsoft/fetch-event-source for header-based authentication
    if (this.config.enableRealtime && typeof fetch !== 'undefined') {
      this.realtime = new RealtimeService(
        this.config.baseUrl,
        this.config.apiKey,
        (connected) => {
          console.log(`[Savvagent] Real-time connection: ${connected ? 'connected' : 'disconnected'}`);
        }
      );

      // Subscribe to all flag updates to invalidate cache
      this.realtime.subscribe('*', (event) => {
        console.log(`[Savvagent] Flag ${event.type}: ${event.flagKey}`);
        this.cache.invalidate(event.flagKey);
      });

      this.realtime.connect();
    }

    // Initialize anonymous ID
    this.anonymousId = this.getOrCreateAnonymousId();
  }

  /**
   * Get or create an anonymous ID for consistent flag evaluation
   * @returns Anonymous ID from localStorage or newly generated
   */
  private getOrCreateAnonymousId(): string {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      // Node.js or non-browser environment - generate session ID
      return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    const storageKey = 'savvagent_anonymous_id';
    let anonId = localStorage.getItem(storageKey);

    if (!anonId) {
      // Generate new anonymous ID
      anonId = `anon_${crypto.randomUUID()}`;
      try {
        localStorage.setItem(storageKey, anonId);
      } catch (e) {
        // localStorage might be disabled - continue with in-memory ID
        console.warn('[Savvagent] Could not save anonymous ID to localStorage:', e);
      }
    }

    return anonId;
  }

  /**
   * Set a custom anonymous ID
   * Useful for cross-device tracking or custom identifier schemes
   * @param id - The anonymous ID to use
   */
  setAnonymousId(id: string): void {
    this.anonymousId = id;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('savvagent_anonymous_id', id);
      } catch (e) {
        console.warn('[Savvagent] Could not save anonymous ID to localStorage:', e);
      }
    }
  }

  /**
   * Set the user ID for logged-in users
   * This takes precedence over anonymous ID
   * @param userId - The user ID (or null to clear)
   */
  setUserId(userId: string | null): void {
    this.userId = userId;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Set the environment for flag evaluation
   * Useful for dynamically switching environments (e.g., dev tools)
   * @param environment - The environment name (e.g., "development", "staging", "production", "beta")
   */
  setEnvironment(environment: string): void {
    this.config.environment = environment;
    // Clear cache when environment changes since flag values may differ
    this.cache.clear();
  }

  /**
   * Get the current environment
   */
  getEnvironment(): string {
    return this.config.environment;
  }

  /**
   * Get the current anonymous ID
   */
  getAnonymousId(): string {
    return this.anonymousId || this.getOrCreateAnonymousId();
  }

  /**
   * Build the context for flag evaluation
   * @param overrides - Context overrides
   */
  private buildContext(overrides?: FlagContext): FlagContext {
    const context: FlagContext = {
      user_id: this.userId || undefined,
      anonymous_id: this.anonymousId || undefined,
      environment: this.config.environment,
      ...overrides,
    };

    // Auto-inject application_id from config if not provided
    if (!context.application_id && this.config.applicationId) {
      context.application_id = this.config.applicationId;
    }

    // Auto-inject language if not provided and detection is enabled
    if (!context.language && this.detectedLanguage) {
      context.language = this.detectedLanguage;
    }

    return context;
  }

  /**
   * Check if a feature flag is enabled
   * @param flagKey - The flag key to evaluate
   * @param context - Optional context for targeting
   * @returns Promise<boolean>
   */
  async isEnabled(flagKey: string, context?: FlagContext): Promise<boolean> {
    const result = await this.evaluate(flagKey, context);
    return result.value;
  }

  /**
   * Evaluate a feature flag and return detailed result
   * @param flagKey - The flag key to evaluate
   * @param context - Optional context for targeting
   * @returns Promise<FlagEvaluationResult>
   */
  async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
    const startTime = Date.now();
    const traceId = TelemetryService.generateTraceId();

    try {
      // Check local overrides first (highest priority)
      if (this.overrides.has(flagKey)) {
        const overrideValue = this.overrides.get(flagKey)!;
        return {
          key: flagKey,
          value: overrideValue,
          reason: 'default', // Using 'default' to indicate override
          metadata: {
            description: 'Local override active',
          },
        };
      }

      // If auth has failed, return default immediately to prevent request spam
      if (this.authFailed) {
        const defaultValue = this.config.defaults[flagKey] ?? false;
        return {
          key: flagKey,
          value: defaultValue,
          reason: 'error',
          metadata: {
            description: 'Authentication failed - using default value',
          },
        };
      }

      // Check cache second
      const cachedValue = this.cache.get(flagKey);
      if (cachedValue !== null) {
        return {
          key: flagKey,
          value: cachedValue,
          reason: 'cached',
        };
      }

      // Build context with user identifiers
      const evaluationContext = this.buildContext(context);

      // Build type-safe request body
      // Cast to any for JsonValue compatibility (all fields are JSON-serializable)
      const requestBody: ApiEvaluateRequest = {
        context: evaluationContext as any,
      };

      // Fetch from API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000);

      const response = await fetch(`${this.config.baseUrl}/api/flags/${flagKey}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Handle auth errors specially - don't retry these
        if (response.status === 401 || response.status === 403) {
          this.authFailed = true;
          // Disconnect realtime to prevent further auth failures
          this.realtime?.disconnect();
          console.error(`[Savvagent] Authentication failed (${response.status}). Check your API key. Further requests disabled.`);
          throw new Error(`Authentication failed: ${response.status}`);
        }
        throw new Error(`Flag evaluation failed: ${response.status}`);
      }

      // Parse response with type safety
      const data: ApiEvaluateResponse = await response.json();
      const value = data.enabled || false;

      // Cache the result (use key as ID since response doesn't include UUID)
      this.cache.set(flagKey, value, data.key);

      // Track evaluation
      const durationMs = Date.now() - startTime;
      this.telemetry.trackEvaluation({
        flagKey,
        result: value,
        context: evaluationContext,
        durationMs,
        traceId,
        timestamp: new Date().toISOString(),
      });

      return {
        key: flagKey,
        value,
        reason: 'evaluated',
        metadata: {
          scope: data.scope,
          configuration: data.configuration,
          variation: data.variation,
          timestamp: data.timestamp,
        },
      };
    } catch (error) {
      // Use default value if provided
      const defaultValue = this.config.defaults[flagKey] ?? false;

      this.config.onError(error as Error);

      return {
        key: flagKey,
        value: defaultValue,
        reason: 'error',
      };
    }
  }

  /**
   * Execute code conditionally based on flag value
   * @param flagKey - The flag key to check
   * @param callback - Function to execute if flag is enabled
   * @param context - Optional context for targeting
   */
  async withFlag<T>(
    flagKey: string,
    callback: () => T | Promise<T>,
    context?: FlagContext
  ): Promise<T | null> {
    const enabled = await this.isEnabled(flagKey, context);

    if (!enabled) {
      return null;
    }

    const evaluationContext = this.buildContext(context);
    const traceId = TelemetryService.generateTraceId();

    try {
      return await callback();
    } catch (error) {
      // Track error with flag context
      this.telemetry.trackError({
        flagKey,
        flagEnabled: true,
        errorType: (error as Error).name || 'Error',
        errorMessage: (error as Error).message || 'Unknown error',
        stackTrace: (error as Error).stack,
        context: evaluationContext,
        traceId,
        timestamp: new Date().toISOString(),
      });

      throw error; // Re-throw after tracking
    }
  }

  /**
   * Manually track an error with flag context
   * @param flagKey - The flag key associated with the error
   * @param error - The error that occurred
   * @param context - Optional context
   */
  trackError(flagKey: string, error: Error, context?: FlagContext): void {
    const evaluationContext = this.buildContext(context);
    this.telemetry.trackError({
      flagKey,
      flagEnabled: true, // Assume enabled if tracking manually
      errorType: error.name || 'Error',
      errorMessage: error.message || 'Unknown error',
      stackTrace: error.stack,
      context: evaluationContext,
      traceId: TelemetryService.generateTraceId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Subscribe to real-time updates for a specific flag
   * @param flagKey - Flag key or '*' for all flags
   * @param callback - Callback when flag is updated
   * @returns Unsubscribe function
   */
  subscribe(flagKey: string, callback: () => void): () => void {
    if (!this.realtime) {
      console.warn('[Savvagent] Real-time updates are disabled');
      return () => {};
    }

    return this.realtime.subscribe(flagKey, () => {
      callback();
    });
  }

  /**
   * Get all cached flag keys
   */
  getCachedFlags(): string[] {
    return this.cache.keys();
  }

  /**
   * Clear the flag cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if real-time connection is active
   */
  isRealtimeConnected(): boolean {
    return this.realtime?.isConnected() || false;
  }

  /**
   * Close the client and cleanup resources
   */
  close(): void {
    this.telemetry.stop();
    this.realtime?.disconnect();
    this.cache.clear();
  }

  // =====================
  // Local Override Methods
  // =====================

  /**
   * Set a local override for a flag.
   * Overrides take precedence over server values and cache.
   *
   * @param flagKey - The flag key to override
   * @param value - The override value (true/false)
   *
   * @example
   * ```typescript
   * // Force a flag to be enabled locally
   * client.setOverride('new-feature', true);
   * ```
   */
  setOverride(flagKey: string, value: boolean): void {
    this.overrides.set(flagKey, value);
    this.notifyOverrideListeners();
  }

  /**
   * Clear a local override for a flag.
   * The flag will return to using server/cached values.
   *
   * @param flagKey - The flag key to clear override for
   */
  clearOverride(flagKey: string): void {
    this.overrides.delete(flagKey);
    this.notifyOverrideListeners();
  }

  /**
   * Clear all local overrides.
   */
  clearAllOverrides(): void {
    this.overrides.clear();
    this.notifyOverrideListeners();
  }

  /**
   * Check if a flag has a local override.
   *
   * @param flagKey - The flag key to check
   * @returns true if the flag has an override
   */
  hasOverride(flagKey: string): boolean {
    return this.overrides.has(flagKey);
  }

  /**
   * Get the override value for a flag.
   *
   * @param flagKey - The flag key to get override for
   * @returns The override value, or undefined if not set
   */
  getOverride(flagKey: string): boolean | undefined {
    return this.overrides.get(flagKey);
  }

  /**
   * Get all current overrides.
   *
   * @returns Record of flag keys to override values
   */
  getOverrides(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    this.overrides.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Set multiple overrides at once.
   *
   * @param overrides - Record of flag keys to override values
   */
  setOverrides(overrides: Record<string, boolean>): void {
    Object.entries(overrides).forEach(([key, value]) => {
      this.overrides.set(key, value);
    });
    this.notifyOverrideListeners();
  }

  /**
   * Subscribe to override changes.
   * Useful for React components to re-render when overrides change.
   *
   * @param callback - Function to call when overrides change
   * @returns Unsubscribe function
   */
  onOverrideChange(callback: () => void): () => void {
    this.overrideListeners.add(callback);
    return () => {
      this.overrideListeners.delete(callback);
    };
  }

  /**
   * Notify all override listeners of a change.
   */
  private notifyOverrideListeners(): void {
    this.overrideListeners.forEach((callback) => {
      try {
        callback();
      } catch (e) {
        console.error('[Savvagent] Override listener error:', e);
      }
    });
  }

  /**
   * Get all flags for the application (and enterprise-scoped flags).
   * Per SDK Developer Guide: GET /api/sdk/flags
   *
   * Use cases:
   * - Local override UI: Display all available flags for developers to toggle
   * - Offline mode: Pre-fetch flags for mobile/desktop apps
   * - SDK initialization: Bootstrap SDK with all flag values on startup
   * - DevTools integration: Show available flags in browser dev panels
   *
   * @param environment - Environment to evaluate enabled state for (default: 'development')
   * @returns Promise<FlagDefinition[]> - List of flag definitions
   *
   * @example
   * ```typescript
   * // Fetch all flags for development
   * const flags = await client.getAllFlags('development');
   *
   * // Bootstrap local cache
   * flags.forEach(flag => {
   *   console.log(`${flag.key}: ${flag.enabled}`);
   * });
   * ```
   */
  async getAllFlags(environment: string = 'development'): Promise<FlagDefinition[]> {
    // If auth has failed, return empty immediately to prevent request spam
    if (this.authFailed) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000);

      const response = await fetch(
        `${this.config.baseUrl}/api/sdk/flags?environment=${encodeURIComponent(environment)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Handle auth errors specially - don't retry these
        if (response.status === 401 || response.status === 403) {
          this.authFailed = true;
          this.realtime?.disconnect();
          console.error(`[Savvagent] Authentication failed (${response.status}). Check your API key. Further requests disabled.`);
          throw new Error(`Authentication failed: ${response.status}`);
        }
        throw new Error(`Failed to fetch flags: ${response.status}`);
      }

      const data: FlagListResponse = await response.json();

      // Optionally cache all flags
      data.flags.forEach((flag) => {
        this.cache.set(flag.key, flag.enabled, flag.key);
      });

      return data.flags;
    } catch (error) {
      this.config.onError(error as Error);
      return [];
    }
  }

  /**
   * Get only enterprise-scoped flags for the organization.
   * Per SDK Developer Guide: GET /api/sdk/enterprise-flags
   *
   * Enterprise flags are shared across all applications in the organization.
   *
   * @param environment - Environment to evaluate enabled state for (default: 'development')
   * @returns Promise<FlagDefinition[]> - List of enterprise flag definitions
   *
   * @example
   * ```typescript
   * // Fetch enterprise-only flags
   * const enterpriseFlags = await client.getEnterpriseFlags('production');
   * ```
   */
  async getEnterpriseFlags(environment: string = 'development'): Promise<FlagDefinition[]> {
    // If auth has failed, return empty immediately to prevent request spam
    if (this.authFailed) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000);

      const response = await fetch(
        `${this.config.baseUrl}/api/sdk/enterprise-flags?environment=${encodeURIComponent(environment)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Handle auth errors specially - don't retry these
        if (response.status === 401 || response.status === 403) {
          this.authFailed = true;
          this.realtime?.disconnect();
          console.error(`[Savvagent] Authentication failed (${response.status}). Check your API key. Further requests disabled.`);
          throw new Error(`Authentication failed: ${response.status}`);
        }
        throw new Error(`Failed to fetch enterprise flags: ${response.status}`);
      }

      const data: FlagListResponse = await response.json();
      return data.flags;
    } catch (error) {
      this.config.onError(error as Error);
      return [];
    }
  }
}
