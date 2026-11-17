import { isValidFlagKey, defaultFor } from '@savvagent/sdk';
import { FlagCache, contextCacheKey, DEFAULT_CACHE_MAX_ENTRIES } from './cache';
import { resolveDefaults } from './defaults';
import { TelemetryService } from './telemetry';
import { RealtimeService } from './realtime';
import {
  CacheEntry,
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  ConfigOverrideOptions,
  ConfigOverrideEntry,
  VariationOverrideEntry,
  FlagDefinition,
  FlagListResponse,
} from './types';

/** Hosts a key may be sent to over plain HTTP without a warning (as in the Rust SDK). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Warn once when a server key would cross the network in clear text: a
 * `srv_` key with a base URL that is not `https` and not a loopback host
 * (#44). The wording matches the Rust SDK.
 */
function warnIfServerKeyInClear(apiKey: string, baseUrl: string): void {
  if (!apiKey.startsWith('srv_')) return;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    // An unparseable base URL fails its requests; there is nothing to warn about yet.
    return;
  }
  const scheme = url.protocol.replace(/:$/, '');
  if (scheme !== 'https' && !LOOPBACK_HOSTS.has(url.hostname)) {
    console.warn(`Savvagent Flags: the server key will be sent over ${scheme}; use an https base_url`);
  }
}

/**
 * Savvagent Server Client for feature flag evaluation with AI-powered error detection
 */
export class FlagClient {
  private config: Required<FlagClientConfig>;
  private cache: FlagCache;
  /**
   * The most recent evaluated value per flag, for trackError when the error's
   * context has no cached entry of its own (bounded by the host's flag keys).
   */
  private lastValues: Map<string, boolean> = new Map();
  private telemetry: TelemetryService;
  private realtime: RealtimeService | null = null;
  private configOverrides: Map<string, ConfigOverrideEntry> = new Map();
  private variationOverrides: Map<string, VariationOverrideEntry> = new Map();
  /** Set by {@link FlagClient.staticFlags}: the values served instead of any lookup. */
  private fixed: Map<string, boolean> | null = null;

  constructor(config: FlagClientConfig) {
    // Apply defaults
    this.config = {
      apiKey: config.apiKey,
      applicationId: config.applicationId || '',
      baseUrl: (config.baseUrl || 'https://api.savvagent.com/flags').replace(/\/+$/, ''),
      environment: config.environment || 'production',
      enableRealtime: config.enableRealtime ?? true,
      cacheTtl: config.cacheTtl ?? 60000,
      cacheMaxEntries: config.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
      enableTelemetry: config.enableTelemetry ?? true,
      // Computed once, here: a `defaultsFrom` function is not re-run per lookup.
      defaults: resolveDefaults(config.defaults || {}, config.defaultsFrom || {}),
      defaultsFrom: config.defaultsFrom || {},
      onError: config.onError || ((error) => console.error('[Savvagent]', error)),
      timeout: config.timeout || 5000,
    };

    // Validate API key - server SDK accepts both SDK keys (sdk_) and Server keys (srv_)
    // Per SDK Developer Guide: SDK keys are for client-side, Server keys are for server-side
    if (!this.config.apiKey || (!this.config.apiKey.startsWith('sdk_') && !this.config.apiKey.startsWith('srv_'))) {
      throw new Error('Invalid API key. API keys must start with "sdk_" (SDK key) or "srv_" (Server key)');
    }

    warnIfServerKeyInClear(this.config.apiKey, this.config.baseUrl);

    // Initialize services
    this.cache = new FlagCache(this.config.cacheTtl, this.config.cacheMaxEntries);
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
        this.invalidateFlag(event.flagKey);
      });

      this.realtime.connect();
    }
  }

  /**
   * A client that serves fixed flag values and never touches the network, for
   * tests.
   *
   * Each flag in `flags` evaluates to its value, any other flag to `false`;
   * `evaluate` reports `reason: 'static'`. No request is made, nothing is
   * reported, no stream is opened and no timer is started. Config and
   * variation overrides still apply, which lets a test exercise code that
   * reads them. `getAllFlags` and `getEnterpriseFlags` return `[]`. It is not
   * for production use: it ignores the server entirely.
   *
   * @example
   * ```ts
   * const client = FlagClient.staticFlags({ 'new-checkout': true });
   * await client.isEnabled('new-checkout'); // true
   * client.isEnabledCached('anything-else'); // false
   * ```
   */
  static staticFlags(
    flags: Readonly<Record<string, boolean>> | Iterable<readonly [string, boolean]>
  ): FlagClient {
    const client = new FlagClient({
      apiKey: 'sdk_static',
      enableRealtime: false,
      enableTelemetry: false,
    });
    const entries: Iterable<readonly [string, boolean]> =
      Symbol.iterator in Object(flags)
        ? (flags as Iterable<readonly [string, boolean]>)
        : Object.entries(flags as Record<string, boolean>);
    const fixed = new Map<string, boolean>();
    for (const [key, value] of entries) fixed.set(key, value === true);
    client.fixed = fixed;
    return client;
  }

  /**
   * The configured default for a flag (`defaults` after `defaultsFrom`). An
   * own-property lookup, so a key such as `__proto__` or `toString` never
   * reads `Object.prototype`.
   */
  private defaultFor(key: string): boolean {
    return defaultFor(this.config.defaults, key);
  }

  /**
   * Invalidate a flag (or every flag) in the cache and forget its last
   * evaluated value, so trackError does not report a value from before the
   * change.
   */
  private invalidateFlag(flagKey?: string): void {
    this.cache.invalidate(flagKey);
    if (flagKey) {
      this.lastValues.delete(flagKey);
    } else {
      this.lastValues.clear();
    }
  }

  /**
   * Context sent to the API: the caller's context plus the configured
   * application and environment.
   */
  private buildEvalContext(context?: FlagContext): FlagContext {
    return {
      ...context,
      application_id: context?.application_id || this.config.applicationId,
      environment: context?.environment || this.config.environment,
    };
  }

  /**
   * Evaluate a feature flag
   */
  async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
    if (!isValidFlagKey(flagKey)) {
      // Untyped callers can pass anything here.
      const key: unknown = flagKey;
      const described =
        typeof key === 'string'
          ? `${JSON.stringify(key.slice(0, 64))} (length ${key.length})`
          : `non-string value of type ${typeof key}`;
      const error = new Error(
        `Invalid flag key ${described}: keys are 1-128 characters of [A-Za-z0-9._-] and not "." or ".."`
      );
      this.config.onError(error);
      return {
        key: typeof key === 'string' ? key : typeof key,
        value: typeof key === 'string' && this.defaultFor(key),
        reason: 'error',
        metadata: { description: error.message },
      };
    }

    if (this.fixed) {
      const configOverride = this.configOverrides.get(flagKey);
      const variationOverride = this.variationOverrides.get(flagKey);
      return {
        key: flagKey,
        value: this.fixed.get(flagKey) === true,
        configuration: configOverride?.config,
        variation: variationOverride?.variation,
        reason: 'static',
      };
    }

    const startTime = Date.now();

    try {
      // Check for variation override first
      const variationOverride = this.variationOverrides.get(flagKey);

      // Prepare context - inject environment from config if not provided
      const evalContext = this.buildEvalContext(context);
      // Cache entries are per flag AND per evaluation context, so one user's
      // result is never served to another.
      const contextKey = contextCacheKey(evalContext);

      // Check cache
      const cachedEntry = this.cache.getEntry(flagKey, contextKey);
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
          metadata: {
            flagId: cachedEntry.flagId,
            version: cachedEntry.version,
            scope: cachedEntry.scope,
          },
        };

        this.lastValues.set(flagKey, cachedEntry.value);

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

      // Read before the request: an invalidation while it is in flight means
      // its result may predate the change, so it is returned but not cached.
      const generation = this.cache.generation(flagKey);

      // Call API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      // Per SDK Developer Guide: POST /api/flags/{key}/evaluate
      let response: Response;
      try {
        response = await fetch(`${this.config.baseUrl}/api/flags/${encodeURIComponent(flagKey)}/evaluate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({ context: evalContext }),
          signal: controller.signal,
        });
      } finally {
        // Also on a rejected fetch, so a failed request leaves no timer behind.
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        enabled?: unknown;
        configuration?: any;
        variation?: string | null;
        flagId?: string;
        description?: string;
        variant?: string;
        version?: unknown;
        scope?: unknown;
      } | null;
      // The result is `enabled` (SDK developer guide). A body without a
      // boolean `enabled` is a failed lookup: substituting the default here
      // would cache it for the TTL as if the server had said so (#126).
      if (typeof data !== 'object' || data === null || typeof data.enabled !== 'boolean') {
        throw new Error(`The evaluate response for ${JSON.stringify(flagKey)} has no boolean \`enabled\``);
      }
      const value = data.enabled;
      // Like the cache write below, a result that predates an invalidation
      // of this flag is not remembered for trackError (#166).
      if (this.cache.generation(flagKey) === generation) {
        this.lastValues.set(flagKey, value);
      }
      // The server sends both as null when the flag has none; the SDK's types say undefined.
      const configuration = data.configuration ?? undefined;
      const variation = data.variation ?? undefined;
      // Metadata the server sends; a malformed field is dropped, never a failed lookup (#165).
      const version =
        typeof data.version === 'number' && Number.isInteger(data.version) ? data.version : undefined;
      const scope = typeof data.scope === 'string' ? data.scope : undefined;

      // Cache the result (including configuration, variation and metadata),
      // unless the flag was invalidated while the request was in flight (#166).
      this.cache.set(
        flagKey,
        value,
        data.flagId,
        configuration,
        variation,
        contextKey,
        { version, scope },
        generation
      );

      // Apply overrides to evaluated result
      let finalConfiguration = configuration;
      let finalVariation = variation;

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
          version,
          scope,
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
      const defaultValue = this.defaultFor(flagKey);

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
   * Read a flag without waiting, for code that cannot be `async`.
   *
   * It makes no request and does not wait: it returns the unexpired cached
   * value for this flag and context (the same context passed to an earlier
   * `evaluate` or `isEnabled`, since the cache is per context), and otherwise
   * the flag's configured default (`defaults` / `defaultsFrom`, else `false`).
   * A flag that has never been looked up, one whose entry has outlived
   * `cacheTtl`, and one invalidated by a realtime update are all misses, so
   * something must keep the cache warm: call `evaluate` or `isEnabled` on the
   * same context at least once per TTL. A hit is counted as an evaluation in
   * telemetry, as a cached `evaluate` is (queued; the batch is sent later,
   * never from this call); a miss is not. On a client from
   * {@link FlagClient.staticFlags} it returns the fixed value. Config and
   * variation overrides never change the answer.
   *
   * @example
   * ```ts
   * const client = new FlagClient({ apiKey, defaults: { 'new-banner': true } });
   * client.isEnabledCached('new-banner'); // true: nothing cached yet, so the default
   * await client.isEnabled('new-banner', { user_id: 'u1' }); // warms the cache for u1
   * client.isEnabledCached('new-banner', { user_id: 'u1' }); // the cached value
   * ```
   */
  isEnabledCached(flagKey: string, context?: FlagContext): boolean {
    // As `evaluate` does, a key no flag can have gets its default.
    if (!isValidFlagKey(flagKey)) {
      const key: unknown = flagKey;
      return typeof key === 'string' && this.defaultFor(key);
    }
    if (this.fixed) {
      return this.fixed.get(flagKey) === true;
    }
    let entry: CacheEntry | null = null;
    try {
      entry = this.cache.getEntry(flagKey, contextCacheKey(this.buildEvalContext(context)));
    } catch {
      // A context that cannot be keyed (e.g. cyclic) is a miss, never a throw.
    }
    if (entry === null) {
      return this.defaultFor(flagKey);
    }
    this.lastValues.set(flagKey, entry.value);
    this.telemetry.trackEvaluation(
      {
        flagKey,
        result: entry.value,
        context,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      },
      { deferFlush: true }
    );
    return entry.value;
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
    // The value cached for this error's own context. An error reported
    // without a context falls back to the flag's most recent evaluation
    // (reporting false would count flag-on errors as flag-off). A context
    // with no cached entry reports false: another context's value would
    // skew flag health for targeted flags (#128).
    let cached: boolean | null = null;
    try {
      cached = this.cache.get(flagKey, contextCacheKey(this.buildEvalContext(context)));
    } catch {
      // A context that cannot be keyed (e.g. cyclic) must not turn error
      // tracking itself into a thrown error; fall back as for a cache miss.
    }
    const flagEnabled =
      cached ?? (context === undefined ? this.lastValues.get(flagKey) : undefined) ?? false;

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
   * Set the environment for flag evaluation.
   * Useful for dynamically switching environments (e.g., dev tools).
   * @param environment - The environment name (e.g., "development", "staging", "production", "beta")
   */
  setEnvironment(environment: string): void {
    this.config.environment = environment;
    // Clear cache when environment changes since flag values may differ
    this.cache.clear();
    this.lastValues.clear();
  }

  /**
   * Get the current environment.
   */
  getEnvironment(): string {
    return this.config.environment;
  }

  /**
   * Invalidate cache for a specific flag or all flags
   */
  invalidateCache(flagKey?: string): void {
    this.invalidateFlag(flagKey);
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
    this.lastValues.clear();
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
    this.lastValues.clear();
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
    if (this.fixed) return [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      let response: Response;
      try {
        response = await fetch(
          `${this.config.baseUrl}/api/sdk/flags?environment=${encodeURIComponent(environment)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch flags: ${response.status}`);
      }

      const data = (await response.json()) as FlagListResponse;

      // Not cached: `enabled` is the environment-level state, not a result
      // evaluated for any particular context, so serving it from the
      // evaluation cache would bypass targeting.
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
    if (this.fixed) return [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      let response: Response;
      try {
        response = await fetch(
          `${this.config.baseUrl}/api/sdk/enterprise-flags?environment=${encodeURIComponent(environment)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeoutId);
      }

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
