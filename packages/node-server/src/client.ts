import { FlagCache } from './cache';
import { TelemetryService } from './telemetry';
import { RealtimeService } from './realtime';
import {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
} from './types';

/**
 * Savvagent Server Client for feature flag evaluation with AI-powered error detection
 */
export class FlagClient {
  private config: Required<FlagClientConfig>;
  private cache: FlagCache;
  private telemetry: TelemetryService;
  private realtime: RealtimeService | null = null;

  constructor(config: FlagClientConfig) {
    // Apply defaults
    this.config = {
      apiKey: config.apiKey,
      applicationId: config.applicationId || '',
      baseUrl: config.baseUrl || 'https://api.savvagent.com',
      enableRealtime: config.enableRealtime ?? true,
      cacheTtl: config.cacheTtl || 60000,
      enableTelemetry: config.enableTelemetry ?? true,
      defaults: config.defaults || {},
      onError: config.onError || ((error) => console.error('[Savvagent]', error)),
      timeout: config.timeout || 5000,
    };

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
    if (this.config.enableRealtime) {
      this.realtime = new RealtimeService(
        this.config.baseUrl,
        this.config.apiKey,
        (connected) => {
          console.log(`[Savvagent] Real-time: ${connected ? 'connected' : 'disconnected'}`);
        }
      );

      // Subscribe to all flag updates to invalidate cache
      this.realtime.subscribe('*', (event) => {
        console.log(`[Savvagent] Flag ${event.type}: ${event.flagKey}`);
        this.cache.invalidate(event.flagKey);
      });

      this.realtime.connect();
    }
  }

  /**
   * Evaluate a feature flag
   */
  async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cachedValue = this.cache.get(flagKey);
      if (cachedValue !== null) {
        const result: FlagEvaluationResult = {
          key: flagKey,
          value: cachedValue,
          reason: 'cached',
        };

        // Track evaluation
        this.telemetry.trackEvaluation({
          flagKey,
          result: cachedValue,
          context,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return result;
      }

      // Prepare context
      const evalContext: FlagContext = {
        ...context,
        application_id: context?.application_id || this.config.applicationId,
      };

      // Call API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}/api/evaluate/${flagKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ context: evalContext }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        value?: boolean;
        flagId?: string;
        description?: string;
        variant?: string;
      };
      const value = data.value ?? this.config.defaults[flagKey] ?? false;

      // Cache the result
      this.cache.set(flagKey, value, data.flagId);

      const result: FlagEvaluationResult = {
        key: flagKey,
        value,
        reason: 'evaluated',
        metadata: {
          flagId: data.flagId,
          description: data.description,
          variant: data.variant,
        },
      };

      // Track evaluation
      this.telemetry.trackEvaluation({
        flagKey,
        result: value,
        context: evalContext,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const err = error as Error;
      this.config.onError(err);

      // Return default value
      const defaultValue = this.config.defaults[flagKey] ?? false;

      // Track evaluation with error
      this.telemetry.trackEvaluation({
        flagKey,
        result: defaultValue,
        context,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      return {
        key: flagKey,
        value: defaultValue,
        reason: 'error',
      };
    }
  }

  /**
   * Check if a flag is enabled (convenience method)
   */
  async isEnabled(flagKey: string, context?: FlagContext): Promise<boolean> {
    const result = await this.evaluate(flagKey, context);
    return result.value;
  }

  /**
   * Subscribe to flag updates
   */
  subscribe(flagKey: string, callback: () => void): () => void {
    if (!this.realtime) {
      console.warn('[Savvagent] Real-time updates are disabled');
      return () => {};
    }

    return this.realtime.subscribe(flagKey, callback);
  }

  /**
   * Track an error that occurred in flagged code
   */
  trackError(flagKey: string, error: Error, context?: FlagContext): void {
    const flagEnabled = this.cache.get(flagKey) ?? false;

    this.telemetry.trackError({
      flagKey,
      flagEnabled,
      errorType: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Invalidate cache for a specific flag or all flags
   */
  invalidateCache(flagKey?: string): void {
    this.cache.invalidate(flagKey);
  }

  /**
   * Clean up resources
   */
  close(): void {
    this.telemetry.close();
    if (this.realtime) {
      this.realtime.close();
    }
    this.cache.clear();
  }
}
