import { FlagCache, contextCacheKey, DEFAULT_CACHE_MAX_ENTRIES } from './cache';
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
 * Whether `key` can be a flag key. Mirrors the server's rule: 1-128 characters
 * from `[A-Za-z0-9._-]`, and not `.` or `..`. The key is sent as one URL path
 * segment, and `.` and `..` cannot be carried in one (clients normalize them
 * away), so no flag can have those keys. Checking before the request keeps an
 * invalid key, and the SDK key sent with it, from steering the request to
 * another endpoint.
 */
function isValidFlagKey(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    key !== '.' &&
    key !== '..' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(key)
  );
}

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
      baseUrl: (config.baseUrl || 'https://api.savvagent.com/flags').replace(/\/+$/, ''),
      environment: config.environment || 'production',
      enableRealtime: config.enableRealtime ?? true,
      cacheTtl: config.cacheTtl ?? 60000,
      cacheMaxEntries: config.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
      enableTelemetry: config.enableTelemetry ?? true,
      defaults: config.defaults || {},
      onError: config.onError || ((error) => console.error('[Savvagent]', error)),
      defaultLanguage: config.defaultLanguage || '',
      disableLanguageDetection: config.disableLanguageDetection ?? false,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      retryBackoff: config.retryBackoff ?? 'exponential',
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
    this.cache = new FlagCache(this.config.cacheTtl, this.config.cacheMaxEntries);
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
   * Read the anonymous ID cookie (set by server integrations), if any.
   */
  private static readAnonymousIdCookie(name: string): string | null {
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
      return null;
    }
    for (const part of document.cookie.split(';')) {
      const [rawKey, ...rest] = part.trim().split('=');
      if (rawKey === name) {
        const raw = rest.join('=');
        try {
          return decodeURIComponent(raw) || null;
        } catch {
          return raw || null;
        }
      }
    }
    return null;
  }

  /**
   * Get or create an anonymous ID for consistent flag evaluation.
   * Uses the `savvagent_anonymous_id` cookie when present (and mirrors it to
   * localStorage), otherwise the ID stored in localStorage, otherwise a new one.
   * @returns Anonymous ID from the cookie, localStorage, or newly generated
   */
  private getOrCreateAnonymousId(): string {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      // Node.js or non-browser environment - generate session ID
      return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    const storageKey = 'savvagent_anonymous_id';

    // Prefer the cookie a server integration (such as @savvagent/astro) set,
    // so server-rendered and client-side evaluations bucket a visitor the same.
    const cookieId = FlagClient.readAnonymousIdCookie(storageKey);
    if (cookieId) {
      try {
        localStorage.setItem(storageKey, cookieId);
      } catch (e) {
        console.warn('[Savvagent] Could not save anonymous ID to localStorage:', e);
      }
      return cookieId;
    }

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
   * Check if an error is retryable (transient failure)
   * @param error - The error to check
   * @param status - HTTP status code (if available)
   */
  private isRetryableError(error: Error, status?: number): boolean {
    // Don't retry auth errors
    if (status === 401 || status === 403) {
      return false;
    }
    // Don't retry client errors (4xx) except for 408 (Request Timeout) and 429 (Too Many Requests)
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return false;
    }
    // Retry server errors (5xx)
    if (status && status >= 500) {
      return true;
    }
    // Retry network errors and timeouts
    if (error.name === 'AbortError' || error.name === 'TypeError' || error.message.includes('network')) {
      return true;
    }
    return false;
  }

  /**
   * Calculate delay for retry attempt
   * @param attempt - Current attempt number (1-based)
   */
  private getRetryDelay(attempt: number): number {
    const baseDelay = this.config.retryDelay;
    if (this.config.retryBackoff === 'linear') {
      return baseDelay * attempt;
    }
    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
    return exponentialDelay + jitter;
  }

  /**
   * The configured default for a flag: `true` only when `defaults` has its
   * own `true` entry for the key. A plain index would read inherited
   * properties, so `__proto__`, `toString` and `constructor` (all valid flag
   * keys) would return `Object.prototype` or a function instead of a boolean.
   */
  private defaultFor(key: string): boolean {
    const defaults = this.config.defaults;
    return Object.prototype.hasOwnProperty.call(defaults, key) && defaults[key] === true;
  }

  /**
   * `fetch` with a 10 second abort timeout. The timer is cleared however the
   * call ends, including when `fetch` throws synchronously (for example when
   * it is not defined), which a `.finally` on its promise would miss.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 10000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Execute a fetch request with retry logic
   * @param requestFn - Function that returns a fetch promise
   * @param operationName - Name of the operation for logging
   */
  private async fetchWithRetry(
    requestFn: () => Promise<Response>,
    operationName: string
  ): Promise<Response> {
    let lastError: Error | null = null;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const response = await requestFn();

        // Handle auth errors immediately - don't retry
        if (response.status === 401 || response.status === 403) {
          this.authFailed = true;
          this.realtime?.disconnect();
          console.error(`[Savvagent] Authentication failed (${response.status}). Check your API key. Further requests disabled.`);
          throw new Error(`Authentication failed: ${response.status}`);
        }

        // If successful, return response
        if (response.ok) {
          return response;
        }

        // Check if we should retry this status code
        lastStatus = response.status;
        lastError = new Error(`${operationName} failed: ${response.status}`);

        if (!this.isRetryableError(lastError, response.status)) {
          throw lastError;
        }

        // Log retry attempt
        if (attempt < this.config.retryAttempts) {
          const delay = this.getRetryDelay(attempt);
          console.warn(`[Savvagent] ${operationName} failed (${response.status}), retrying in ${Math.round(delay)}ms (attempt ${attempt}/${this.config.retryAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        lastError = error as Error;

        // Don't retry auth errors
        if (lastError.message.includes('Authentication failed')) {
          throw lastError;
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError, lastStatus)) {
          throw lastError;
        }

        // Log retry attempt
        if (attempt < this.config.retryAttempts) {
          const delay = this.getRetryDelay(attempt);
          console.warn(`[Savvagent] ${operationName} error: ${lastError.message}, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${this.config.retryAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error(`${operationName} failed after ${this.config.retryAttempts} attempts`);
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
        // Not String(key): that throws for an object with a null prototype.
        key: typeof key === 'string' ? key : typeof key,
        value: typeof key === 'string' ? this.defaultFor(key) : false,
        reason: 'error',
        metadata: {
          description: error.message,
        },
      };
    }

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
        const defaultValue = this.defaultFor(flagKey);
        return {
          key: flagKey,
          value: defaultValue,
          reason: 'error',
          metadata: {
            description: 'Authentication failed - using default value',
          },
        };
      }

      // Build context with user identifiers
      const evaluationContext = this.buildContext(context);
      // Cache entries are per flag AND per evaluation context, so one user's
      // result is never served to another.
      const contextKey = contextCacheKey(evaluationContext);

      // Check cache second
      const cached = this.cache.getEntry(flagKey, contextKey);
      if (cached !== null) {
        return {
          key: flagKey,
          value: cached.value,
          reason: 'cached',
          ...(cached.metadata ? { metadata: cached.metadata } : {}),
        };
      }

      // Build type-safe request body
      // Cast to any for JsonValue compatibility (all fields are JSON-serializable)
      const requestBody: ApiEvaluateRequest = {
        context: evaluationContext as any,
      };

      // Read before the request: if the flag is invalidated while it is in
      // flight, its result is stale and is not cached.
      const generation = this.cache.generation(flagKey);

      // Fetch from API with retry logic
      const response = await this.fetchWithRetry(
        () =>
          // Defence in depth: every valid key is RFC 3986 unreserved, so this
          // encoding changes nothing for a key that passed isValidFlagKey.
          this.fetchWithTimeout(`${this.config.baseUrl}/api/flags/${encodeURIComponent(flagKey)}/evaluate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify(requestBody),
          }),
        `Flag evaluation (${flagKey})`
      );

      // Parse response with type safety
      const data = (await response.json()) as ApiEvaluateResponse | null;
      // The result is `enabled` (SDK developer guide). A body without a
      // boolean `enabled` is a failed lookup: substituting the default here
      // would cache it for the TTL as if the server had said so.
      if (typeof data !== 'object' || data === null || typeof data.enabled !== 'boolean') {
        throw new Error(`The evaluate response for ${JSON.stringify(flagKey)} has no boolean \`enabled\``);
      }
      const value = data.enabled;

      // `version` and `scope` are read untyped: the generated response type has no `version`,
      // and a malformed value is dropped rather than failing the lookup.
      const raw = data as { version?: unknown; scope?: unknown };
      const version =
        typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : undefined;
      const scope = typeof raw.scope === 'string' || raw.scope === null ? raw.scope : undefined;

      const metadata: FlagEvaluationResult['metadata'] = {
        scope,
        version,
        // The server sends both as null when the flag has none; the SDK's types say undefined.
        configuration: data.configuration ?? undefined,
        variation: data.variation ?? undefined,
        timestamp: data.timestamp,
      };

      // Cache the result for this context (use key as ID since response doesn't include UUID)
      this.cache.set(flagKey, value, data.key, contextKey, metadata, generation);

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
        metadata,
      };
    } catch (error) {
      // Use default value if provided
      const defaultValue = this.defaultFor(flagKey);

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
   * Overrides take precedence over server values and cache. Setting one
   * invalidates the flag's cached results, so an evaluation in flight is not cached.
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
    this.cache.invalidate(flagKey);
    this.notifyOverrideListeners();
  }

  /**
   * Clear a local override for a flag.
   * The flag will return to using server values. Its cached results are
   * invalidated, so the next evaluation asks the server again.
   *
   * @param flagKey - The flag key to clear override for
   */
  clearOverride(flagKey: string): void {
    this.overrides.delete(flagKey);
    this.cache.invalidate(flagKey);
    this.notifyOverrideListeners();
  }

  /**
   * Clear all local overrides.
   */
  clearAllOverrides(): void {
    this.overrides.forEach((_value, key) => this.cache.invalidate(key));
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
      this.cache.invalidate(key);
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
      const response = await this.fetchWithRetry(
        () =>
          this.fetchWithTimeout(
            `${this.config.baseUrl}/api/sdk/flags?environment=${encodeURIComponent(environment)}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
              },
            }
          ),
        'Get all flags'
      );

      const data: FlagListResponse = await response.json();

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
    // If auth has failed, return empty immediately to prevent request spam
    if (this.authFailed) {
      return [];
    }

    try {
      const response = await this.fetchWithRetry(
        () =>
          this.fetchWithTimeout(
            `${this.config.baseUrl}/api/sdk/enterprise-flags?environment=${encodeURIComponent(environment)}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
              },
            }
          ),
        'Get enterprise flags'
      );

      const data: FlagListResponse = await response.json();
      return data.flags;
    } catch (error) {
      this.config.onError(error as Error);
      return [];
    }
  }
}
