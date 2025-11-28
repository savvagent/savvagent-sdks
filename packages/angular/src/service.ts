import { Injectable, OnDestroy, Inject, InjectionToken, Optional } from '@angular/core';
import { BehaviorSubject, Observable, from, of, Subject } from 'rxjs';
import { map, takeUntil, catchError, distinctUntilChanged } from 'rxjs/operators';
import { FlagClient, FlagClientConfig, FlagContext, FlagEvaluationResult, FlagDefinition } from '@savvagent/sdk';

/**
 * Default context values that apply to all flag evaluations
 * Per SDK Developer Guide: https://docs.savvagent.com/sdk-developer-guide
 */
export interface DefaultFlagContext {
  /** Application ID for application-scoped flags */
  applicationId?: string;
  /** Environment (development, staging, production) */
  environment?: string;
  /** Organization ID for multi-tenant apps */
  organizationId?: string;
  /** Default user ID (required for percentage rollouts) */
  userId?: string;
  /** Default anonymous ID (alternative to userId for anonymous users) */
  anonymousId?: string;
  /** Session ID as fallback identifier */
  sessionId?: string;
  /** User's language code (e.g., "en", "es") */
  language?: string;
  /** Default attributes for targeting */
  attributes?: Record<string, any>;
}

/**
 * Configuration for the Savvagent Angular service
 */
export interface SavvagentConfig {
  /** SDK API key configuration */
  config: FlagClientConfig;
  /** Default context values applied to all flag evaluations */
  defaultContext?: DefaultFlagContext;
}

/**
 * Injection token for Savvagent configuration
 */
export const SAVVAGENT_CONFIG = new InjectionToken<SavvagentConfig>('SAVVAGENT_CONFIG');

/**
 * Result from flag evaluation as an Observable
 */
export interface FlagObservableResult {
  /** Current flag value */
  value: boolean;
  /** Whether the flag is currently being evaluated */
  loading: boolean;
  /** Error if evaluation failed */
  error: Error | null;
  /** Detailed evaluation result */
  result: FlagEvaluationResult | null;
}

/**
 * Options for flag evaluation
 */
export interface FlagOptions {
  /** Context for flag evaluation (user_id, attributes, etc.) */
  context?: FlagContext;
  /** Default value to use while loading or on error */
  defaultValue?: boolean;
  /** Enable real-time updates for this flag */
  realtime?: boolean;
}

/**
 * Angular service for Savvagent feature flags.
 * Provides reactive flag evaluation using RxJS Observables.
 *
 * @example
 * ```typescript
 * // In your component
 * @Component({...})
 * export class MyComponent {
 *   newFeature$ = this.savvagent.flag$('new-feature');
 *
 *   constructor(private savvagent: SavvagentService) {}
 * }
 *
 * // In your template
 * <div *ngIf="(newFeature$ | async)?.value">
 *   New feature content!
 * </div>
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class SavvagentService implements OnDestroy {
  private client: FlagClient | null = null;
  private destroy$ = new Subject<void>();
  private isReady$ = new BehaviorSubject<boolean>(false);
  private defaultContext: FlagContext = {};
  private flagSubjects = new Map<string, BehaviorSubject<FlagObservableResult>>();

  constructor(
    @Optional() @Inject(SAVVAGENT_CONFIG) config?: SavvagentConfig
  ) {
    if (config) {
      this.initialize(config);
    }
  }

  /**
   * Initialize the Savvagent client with configuration.
   * Call this if not using the SAVVAGENT_CONFIG injection token.
   *
   * @param savvagentConfig - Configuration including API key and default context
   *
   * @example
   * ```typescript
   * @Component({...})
   * export class AppComponent implements OnInit {
   *   constructor(private savvagent: SavvagentService) {}
   *
   *   ngOnInit() {
   *     this.savvagent.initialize({
   *       config: { apiKey: 'sdk_...' },
   *       defaultContext: {
   *         applicationId: 'my-app',
   *         environment: 'development',
   *         userId: 'user-123'
   *       }
   *     });
   *   }
   * }
   * ```
   */
  initialize(savvagentConfig: SavvagentConfig): void {
    if (this.client) {
      console.warn('[Savvagent] Client already initialized. Call close() first to reinitialize.');
      return;
    }

    try {
      this.client = new FlagClient(savvagentConfig.config);

      // Convert DefaultFlagContext to FlagContext format (camelCase to snake_case)
      if (savvagentConfig.defaultContext) {
        this.defaultContext = {
          application_id: savvagentConfig.defaultContext.applicationId,
          environment: savvagentConfig.defaultContext.environment,
          organization_id: savvagentConfig.defaultContext.organizationId,
          user_id: savvagentConfig.defaultContext.userId,
          anonymous_id: savvagentConfig.defaultContext.anonymousId,
          session_id: savvagentConfig.defaultContext.sessionId,
          language: savvagentConfig.defaultContext.language,
          attributes: savvagentConfig.defaultContext.attributes,
        };
      }

      this.isReady$.next(true);

      // Subscribe to override changes to re-evaluate all active flags
      this.client.onOverrideChange(() => {
        this.reEvaluateAllFlags();
      });
    } catch (error) {
      console.error('[Savvagent] Failed to initialize client:', error);
      savvagentConfig.config.onError?.(error as Error);
    }
  }

  /**
   * Observable that emits true when the client is ready.
   */
  get ready$(): Observable<boolean> {
    return this.isReady$.asObservable();
  }

  /**
   * Check if the client is ready.
   */
  get isReady(): boolean {
    return this.isReady$.value;
  }

  /**
   * Get the underlying FlagClient instance for advanced use cases.
   */
  get flagClient(): FlagClient | null {
    return this.client;
  }

  /**
   * Merge default context with per-call context.
   */
  private mergeContext(context?: FlagContext): FlagContext {
    return {
      ...this.defaultContext,
      ...context,
      attributes: {
        ...this.defaultContext.attributes,
        ...context?.attributes,
      },
    };
  }

  /**
   * Get a reactive Observable for a feature flag.
   * Automatically updates when the flag value changes.
   *
   * @param flagKey - The feature flag key to evaluate
   * @param options - Configuration options
   * @returns Observable of flag evaluation state
   *
   * @example
   * ```typescript
   * // In your component
   * newFeature$ = this.savvagent.flag$('new-feature', {
   *   defaultValue: false,
   *   realtime: true,
   *   context: { attributes: { plan: 'pro' } }
   * });
   *
   * // In template
   * <ng-container *ngIf="newFeature$ | async as flag">
   *   <app-loading *ngIf="flag.loading"></app-loading>
   *   <app-new-feature *ngIf="flag.value"></app-new-feature>
   *   <app-old-feature *ngIf="!flag.value && !flag.loading"></app-old-feature>
   * </ng-container>
   * ```
   */
  flag$(flagKey: string, options: FlagOptions = {}): Observable<FlagObservableResult> {
    const { context, defaultValue = false, realtime = true } = options;
    const mergedContext = this.mergeContext(context);
    const cacheKey = this.getCacheKey(flagKey, mergedContext);

    // Check if we already have a subject for this flag+context
    if (!this.flagSubjects.has(cacheKey)) {
      const subject = new BehaviorSubject<FlagObservableResult>({
        value: defaultValue,
        loading: true,
        error: null,
        result: null,
      });
      this.flagSubjects.set(cacheKey, subject);

      // Initial evaluation
      this.evaluateAndEmit(flagKey, mergedContext, defaultValue, subject);

      // Set up real-time subscription if enabled
      if (realtime && this.client) {
        const unsubscribe = this.client.subscribe(flagKey, () => {
          this.evaluateAndEmit(flagKey, mergedContext, defaultValue, subject);
        });

        // Clean up subscription when subject is complete
        subject.pipe(takeUntil(this.destroy$)).subscribe({
          complete: () => unsubscribe(),
        });
      }
    }

    return this.flagSubjects.get(cacheKey)!.asObservable().pipe(
      takeUntil(this.destroy$),
      distinctUntilChanged((a, b) =>
        a.value === b.value &&
        a.loading === b.loading &&
        a.error === b.error
      )
    );
  }

  /**
   * Generate a cache key for a flag+context combination.
   */
  private getCacheKey(flagKey: string, context: FlagContext): string {
    return `${flagKey}:${JSON.stringify(context)}`;
  }

  /**
   * Evaluate a flag and emit the result to a subject.
   */
  private async evaluateAndEmit(
    flagKey: string,
    context: FlagContext,
    defaultValue: boolean,
    subject: BehaviorSubject<FlagObservableResult>
  ): Promise<void> {
    if (!this.client) {
      subject.next({
        value: defaultValue,
        loading: false,
        error: new Error('Savvagent client not initialized'),
        result: null,
      });
      return;
    }

    try {
      const result = await this.client.evaluate(flagKey, context);
      subject.next({
        value: result.value,
        loading: false,
        error: null,
        result,
      });
    } catch (error) {
      subject.next({
        value: defaultValue,
        loading: false,
        error: error as Error,
        result: null,
      });
    }
  }

  /**
   * Re-evaluate all active flag subscriptions.
   * Called when overrides change.
   */
  private reEvaluateAllFlags(): void {
    this.flagSubjects.forEach((subject, cacheKey) => {
      const [flagKey, contextJson] = cacheKey.split(':', 2);
      const context = JSON.parse(contextJson || '{}');
      const currentValue = subject.value;
      this.evaluateAndEmit(flagKey, context, currentValue.value, subject);
    });
  }

  /**
   * Get a flag value as a simple Observable<boolean>.
   * Useful when you only need the value without loading/error states.
   *
   * @param flagKey - The feature flag key to evaluate
   * @param options - Configuration options
   * @returns Observable of boolean flag value
   *
   * @example
   * ```typescript
   * isFeatureEnabled$ = this.savvagent.flagValue$('my-feature');
   *
   * // In template
   * <button *ngIf="isFeatureEnabled$ | async">New Button</button>
   * ```
   */
  flagValue$(flagKey: string, options: FlagOptions = {}): Observable<boolean> {
    return this.flag$(flagKey, options).pipe(
      map((result) => result.value),
      distinctUntilChanged()
    );
  }

  /**
   * Evaluate a feature flag once (non-reactive).
   * For reactive updates, use flag$() instead.
   *
   * @param flagKey - The feature flag key to evaluate
   * @param context - Optional context for targeting
   * @returns Promise with detailed evaluation result
   *
   * @example
   * ```typescript
   * async checkFeature() {
   *   const result = await this.savvagent.evaluate('new-feature');
   *   if (result.value) {
   *     // Feature is enabled
   *   }
   * }
   * ```
   */
  async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
    if (!this.client) {
      throw new Error('Savvagent client not initialized');
    }
    return this.client.evaluate(flagKey, this.mergeContext(context));
  }

  /**
   * Check if a feature flag is enabled (non-reactive).
   *
   * @param flagKey - The feature flag key to evaluate
   * @param context - Optional context for targeting
   * @returns Promise<boolean>
   */
  async isEnabled(flagKey: string, context?: FlagContext): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    return this.client.isEnabled(flagKey, this.mergeContext(context));
  }

  /**
   * Execute code conditionally based on flag value.
   *
   * @param flagKey - The flag key to check
   * @param callback - Function to execute if flag is enabled
   * @param context - Optional context for targeting
   *
   * @example
   * ```typescript
   * await this.savvagent.withFlag('analytics-enabled', async () => {
   *   await this.analytics.track('page_view');
   * });
   * ```
   */
  async withFlag<T>(
    flagKey: string,
    callback: () => T | Promise<T>,
    context?: FlagContext
  ): Promise<T | null> {
    if (!this.client) {
      return null;
    }
    return this.client.withFlag(flagKey, callback, this.mergeContext(context));
  }

  /**
   * Track an error with flag context.
   *
   * @param flagKey - The flag key associated with the error
   * @param error - The error that occurred
   * @param context - Optional context
   */
  trackError(flagKey: string, error: Error, context?: FlagContext): void {
    this.client?.trackError(flagKey, error, this.mergeContext(context));
  }

  /**
   * Set the user ID for logged-in users.
   *
   * @param userId - The user ID (or null to clear)
   */
  setUserId(userId: string | null): void {
    this.client?.setUserId(userId);
  }

  /**
   * Get the current user ID.
   */
  getUserId(): string | null {
    return this.client?.getUserId() || null;
  }

  /**
   * Get the current anonymous ID.
   */
  getAnonymousId(): string | null {
    return this.client?.getAnonymousId() || null;
  }

  /**
   * Set a custom anonymous ID.
   */
  setAnonymousId(id: string): void {
    this.client?.setAnonymousId(id);
  }

  // =====================
  // Local Override Methods
  // =====================

  /**
   * Set a local override for a flag.
   * Overrides take precedence over server values.
   *
   * @param flagKey - The flag key to override
   * @param value - The override value
   */
  setOverride(flagKey: string, value: boolean): void {
    this.client?.setOverride(flagKey, value);
  }

  /**
   * Clear a local override for a flag.
   */
  clearOverride(flagKey: string): void {
    this.client?.clearOverride(flagKey);
  }

  /**
   * Clear all local overrides.
   */
  clearAllOverrides(): void {
    this.client?.clearAllOverrides();
  }

  /**
   * Check if a flag has a local override.
   */
  hasOverride(flagKey: string): boolean {
    return this.client?.hasOverride(flagKey) || false;
  }

  /**
   * Get the override value for a flag.
   */
  getOverride(flagKey: string): boolean | undefined {
    return this.client?.getOverride(flagKey);
  }

  /**
   * Get all current overrides.
   */
  getOverrides(): Record<string, boolean> {
    return this.client?.getOverrides() || {};
  }

  /**
   * Set multiple overrides at once.
   */
  setOverrides(overrides: Record<string, boolean>): void {
    this.client?.setOverrides(overrides);
  }

  // =====================
  // Flag Discovery Methods
  // =====================

  /**
   * Get all flags for the application.
   *
   * @param environment - Environment to evaluate (default: 'development')
   * @returns Observable of flag definitions
   */
  getAllFlags$(environment: string = 'development'): Observable<FlagDefinition[]> {
    if (!this.client) {
      return of([]);
    }
    return from(this.client.getAllFlags(environment)).pipe(
      catchError((error) => {
        console.error('[Savvagent] Failed to fetch all flags:', error);
        return of([]);
      })
    );
  }

  /**
   * Get all flags for the application (Promise-based).
   */
  async getAllFlags(environment: string = 'development'): Promise<FlagDefinition[]> {
    if (!this.client) {
      return [];
    }
    return this.client.getAllFlags(environment);
  }

  /**
   * Get enterprise-scoped flags only.
   */
  async getEnterpriseFlags(environment: string = 'development'): Promise<FlagDefinition[]> {
    if (!this.client) {
      return [];
    }
    return this.client.getEnterpriseFlags(environment);
  }

  // =====================
  // Cache & Connection
  // =====================

  /**
   * Clear the flag cache.
   */
  clearCache(): void {
    this.client?.clearCache();
  }

  /**
   * Check if real-time connection is active.
   */
  isRealtimeConnected(): boolean {
    return this.client?.isRealtimeConnected() || false;
  }

  /**
   * Close the client and cleanup resources.
   */
  close(): void {
    this.client?.close();
    this.client = null;
    this.isReady$.next(false);
    this.flagSubjects.forEach((subject) => subject.complete());
    this.flagSubjects.clear();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.close();
  }
}
