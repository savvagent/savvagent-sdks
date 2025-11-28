import { FlagCache } from './cache';
import { TelemetryService } from './telemetry';
import { RealtimeService } from './realtime';
import {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  ConfigOverrideOptions,
  ConfigOverrideEntry,
  VariationOverrideEntry,
  FlagDefinition,
  FlagListResponse,
} from './types';

/**
 * Savvagent Server Client for feature flag evaluation with AI-powered error detection
 */
export class FlagClient {
  private config: Required<FlagClientConfig>;
  private cache: FlagCache;
  private telemetry: TelemetryService;
  private realtime: RealtimeService | null = null;
  private configOverrides: Map<string, ConfigOverrideEntry> = new Map();
  private variationOverrides: Map<string, VariationOverrideEntry> = new Map();

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

    // Validate API key - server SDK accepts both SDK keys (sdk_) and Server keys (srv_)
    // Per SDK Developer Guide: SDK keys are for client-side, Server keys are for server-side
    if (!this.config.apiKey || (!this.config.apiKey.startsWith('sdk_') && !this.config.apiKey.startsWith('srv_'))) {
      throw new Error('Invalid API key. API keys must start with "sdk_" (SDK key) or "srv_" (Server key)');
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
      // Check for variation override first
      const variationOverride = this.variationOverrides.get(flagKey);

      // Check cache
      const cachedEntry = this.cache.getEntry(flagKey);
      if (cachedEntry !== null) {
        let configuration = cachedEntry.configuration;
        let variation = cachedEntry.variation;

        // Apply configuration override
        const configOverride = this.configOverrides.get(flagKey);
        if (configOverride) {
          if (configOverride.merge && configuration) {
            configuration = this.mergeConfigurations(configuration, configOverride.config);
          } else {
            configuration = configOverride.config;
          }
        }

        // Apply variation override
        if (variationOverride) {
          variation = variationOverride.variation;
        }

        const result: FlagEvaluationResult = {
          key: flagKey,
          value: cachedEntry.value,
          configuration,
          variation,
          reason: 'cached',
        };

        // Track evaluation
        this.telemetry.trackEvaluation({
          flagKey,
          result: cachedEntry.value,
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

      // Per SDK Developer Guide: POST /api/flags/{key}/evaluate
      const response = await fetch(`${this.config.baseUrl}/api/flags/${flagKey}/evaluate`, {
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
        configuration?: any;
        variation?: string;
        flagId?: string;
        description?: string;
        variant?: string;
      };
      const value = data.value ?? this.config.defaults[flagKey] ?? false;

      // Cache the result (including configuration and variation)
      this.cache.set(flagKey, value, data.flagId, data.configuration, data.variation);

      // Apply overrides to evaluated result
      let finalConfiguration = data.configuration;
      let finalVariation = data.variation;

      const configOverride = this.configOverrides.get(flagKey);
      if (configOverride) {
        if (configOverride.merge && finalConfiguration) {
          finalConfiguration = this.mergeConfigurations(finalConfiguration, configOverride.config);
        } else {
          finalConfiguration = configOverride.config;
        }
      }

      if (variationOverride) {
        finalVariation = variationOverride.variation;
      }

      const result: FlagEvaluationResult = {
        key: flagKey,
        value,
        configuration: finalConfiguration,
        variation: finalVariation,
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
   * Get dynamic configuration for a flag (Phase 1)
   * Returns configuration if flag is enabled, otherwise returns defaultValue or null
   */
  async getConfig<T = any>(
    flagKey: string,
    context?: FlagContext,
    defaultValue?: T
  ): Promise<T | null> {
    const result = await this.evaluate(flagKey, context);

    if (!result.value) {
      return defaultValue ?? null;
    }

    return result.configuration ?? defaultValue ?? null;
  }

  /**
   * Get variation details for multi-variant flags (Phase 2)
   * Returns variation name, enabled status, and configuration
   */
  async getVariation(
    flagKey: string,
    context?: FlagContext
  ): Promise<{ variation: string; enabled: boolean; configuration?: any }> {
    const result = await this.evaluate(flagKey, context);
    return {
      variation: result.variation || 'control',
      enabled: result.value,
      configuration: result.configuration,
    };
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

  /**
   * Set a configuration override for a flag
   * Useful for testing different configuration values without server changes
   */
  setConfigOverride(
    flagKey: string,
    config: any,
    options?: ConfigOverrideOptions
  ): void {
    const validate = options?.validate ?? true;
    const merge = options?.merge ?? false;

    // Validate JSON structure
    if (validate) {
      try {
        JSON.stringify(config);
      } catch (error) {
        const err = error as Error;
        throw new Error(`Invalid configuration for flag '${flagKey}': ${err.message}`);
      }
    }

    // Store override
    this.configOverrides.set(flagKey, {
      config,
      merge,
      timestamp: Date.now(),
    });

    // Invalidate cache to force re-evaluation with override
    this.cache.invalidate(flagKey);
  }

  /**
   * Clear configuration override for a flag
   */
  clearConfigOverride(flagKey: string): void {
    this.configOverrides.delete(flagKey);
    // Invalidate cache to get fresh API values
    this.cache.invalidate(flagKey);
  }

  /**
   * Set a variation override for a multi-variant flag
   * Forces the flag to return a specific variation
   */
  setVariationOverride(flagKey: string, variation: string): void {
    this.variationOverrides.set(flagKey, {
      variation,
      timestamp: Date.now(),
    });

    // Invalidate cache to force re-evaluation with override
    this.cache.invalidate(flagKey);
  }

  /**
   * Clear variation override for a flag
   */
  clearVariationOverride(flagKey: string): void {
    this.variationOverrides.delete(flagKey);
    // Invalidate cache to get fresh API values
    this.cache.invalidate(flagKey);
  }

  /**
   * Check if a flag has a configuration override
   */
  hasConfigOverride(flagKey: string): boolean {
    return this.configOverrides.has(flagKey);
  }

  /**
   * Check if a flag has a variation override
   */
  hasVariationOverride(flagKey: string): boolean {
    return this.variationOverrides.has(flagKey);
  }

  /**
   * Get all configuration overrides (for debugging/inspection)
   */
  getConfigOverrides(): Record<string, { config: any; merge: boolean; timestamp: number }> {
    const overrides: Record<string, { config: any; merge: boolean; timestamp: number }> = {};
    this.configOverrides.forEach((entry, key) => {
      overrides[key] = {
        config: entry.config,
        merge: entry.merge,
        timestamp: entry.timestamp,
      };
    });
    return overrides;
  }

  /**
   * Get all variation overrides (for debugging/inspection)
   */
  getVariationOverrides(): Record<string, { variation: string; timestamp: number }> {
    const overrides: Record<string, { variation: string; timestamp: number }> = {};
    this.variationOverrides.forEach((entry, key) => {
      overrides[key] = {
        variation: entry.variation,
        timestamp: entry.timestamp,
      };
    });
    return overrides;
  }

  /**
   * Clear all configuration and variation overrides
   */
  clearAllOverrides(): void {
    this.configOverrides.clear();
    this.variationOverrides.clear();
    this.cache.clear();
  }

  /**
   * Merge two configuration objects (for partial overrides)
   * Deep merge where override values take precedence
   */
  private mergeConfigurations(base: any, override: any): any {
    if (!base || typeof base !== 'object') {
      return override;
    }
    if (!override || typeof override !== 'object') {
      return override;
    }

    const result = { ...base };

    for (const key in override) {
      if (Object.prototype.hasOwnProperty.call(override, key)) {
        if (
          typeof override[key] === 'object' &&
          override[key] !== null &&
          !Array.isArray(override[key]) &&
          typeof result[key] === 'object' &&
          result[key] !== null &&
          !Array.isArray(result[key])
        ) {
          // Recursively merge nested objects
          result[key] = this.mergeConfigurations(result[key], override[key]);
        } else {
          // Override primitive values, arrays, and nulls
          result[key] = override[key];
        }
      }
    }

    return result;
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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

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
        throw new Error(`Failed to fetch flags: ${response.status}`);
      }

      const data = (await response.json()) as FlagListResponse;

      // Cache all flags
      data.flags.forEach((flag) => {
        this.cache.set(flag.key, flag.enabled, flag.key, flag.configuration);
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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

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
        throw new Error(`Failed to fetch enterprise flags: ${response.status}`);
      }

      const data = (await response.json()) as FlagListResponse;
      return data.flags;
    } catch (error) {
      this.config.onError(error as Error);
      return [];
    }
  }
}
