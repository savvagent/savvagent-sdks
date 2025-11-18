import { FlagCache } from './cache';
import { TelemetryService } from './telemetry';
import { RealtimeService } from './realtime';
import {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
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

  constructor(config: FlagClientConfig) {
    // Apply defaults
    this.config = {
      apiKey: config.apiKey,
      applicationId: config.applicationId || '',
      baseUrl: config.baseUrl || 'http://localhost:8080',
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
    if (this.config.enableRealtime && typeof EventSource !== 'undefined') {
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
      environment: 'production', // TODO: Make configurable
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
      // Check cache first
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

      // Fetch from API
      const response = await fetch(`${this.config.baseUrl}/api/flags/${flagKey}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
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
}
