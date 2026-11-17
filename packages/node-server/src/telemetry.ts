import { EvaluationEvent, ErrorEvent } from './types';

/**
 * Service for tracking flag evaluations and errors
 * Per SDK Developer Guide: Batch evaluations and send every 5-10 seconds
 */
export class TelemetryService {
  private baseUrl: string;
  private apiKey: string;
  private enabled: boolean;
  private evaluationQueue: EvaluationEvent[] = [];
  private errorQueue: ErrorEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  /** A deferred evaluation flush is pending (see trackEvaluation's deferFlush). */
  private flushScheduled = false;
  /** Set by close(): a deferred flush scheduled earlier then sends nothing. */
  private closed = false;
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds

  constructor(baseUrl: string, apiKey: string, enabled: boolean = true) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.enabled = enabled;

    if (this.enabled) {
      this.startAutoFlush();
    }
  }

  /**
   * Track a flag evaluation
   *
   * @param options.deferFlush - When the batch is full, send it from a later
   *   turn of the event loop instead of from this call, so a synchronous
   *   caller (`FlagClient.isEnabledCached`) never starts a request itself.
   */
  trackEvaluation(event: EvaluationEvent, options?: { deferFlush?: boolean }): void {
    if (!this.enabled) return;

    this.evaluationQueue.push(event);

    if (this.evaluationQueue.length >= this.BATCH_SIZE) {
      if (options?.deferFlush) {
        this.scheduleFlush();
      } else {
        this.flushEvaluations();
      }
    }
  }

  /** Flush evaluations once, from a later turn of the event loop. */
  private scheduleFlush(): void {
    if (this.flushScheduled || this.closed) return;
    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      if (this.closed) return;
      this.flushEvaluations();
    });
  }

  /**
   * Track an error in flagged code
   * Errors are flushed more frequently as they're critical telemetry
   */
  trackError(event: ErrorEvent): void {
    if (!this.enabled) return;

    this.errorQueue.push(event);

    // Flush errors immediately (critical telemetry)
    this.flushErrors();
  }

  /**
   * Start auto-flushing events
   */
  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL);
    // Do not keep the process alive for telemetry alone; close() flushes what is queued.
    (this.flushInterval as { unref?: () => void }).unref?.();
  }

  /**
   * Flush all events to the server
   */
  async flush(): Promise<void> {
    await Promise.all([
      this.flushEvaluations(),
      this.flushErrors(),
    ]);
  }

  /**
   * Flush evaluation events to the server
   * Per SDK Developer Guide: POST /api/telemetry/evaluations with { "evaluations": [...] }
   */
  private async flushEvaluations(): Promise<void> {
    if (this.evaluationQueue.length === 0) return;

    const events = [...this.evaluationQueue];
    this.evaluationQueue = [];

    // Transform to API format per SDK Developer Guide
    const evaluations = events.map((e) => ({
      flag_key: e.flagKey,
      result: e.result,
      user_id: e.context?.user_id,
      context: e.context,
      timestamp: Math.floor(new Date(e.timestamp).getTime() / 1000),
    }));

    try {
      const response = await fetch(`${this.baseUrl}/api/telemetry/evaluations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ evaluations }),
      });

      if (!response.ok) {
        console.warn('[Savvagent] Failed to send evaluations:', response.statusText);
      }
    } catch (error) {
      console.warn('[Savvagent] Error sending evaluations:', error);
    }
  }

  /**
   * Flush error events to the server
   * Per SDK Developer Guide: POST /api/telemetry/errors with { "errors": [...] }
   */
  private async flushErrors(): Promise<void> {
    if (this.errorQueue.length === 0) return;

    const events = [...this.errorQueue];
    this.errorQueue = [];

    // Transform to API format per SDK Developer Guide
    const errors = events.map((e) => ({
      flag_key: e.flagKey,
      flag_enabled: e.flagEnabled,
      error_type: e.errorType,
      error_message: e.errorMessage,
      stack_trace: e.stackTrace,
      context: e.context,
      timestamp: Math.floor(new Date(e.timestamp).getTime() / 1000),
    }));

    try {
      const response = await fetch(`${this.baseUrl}/api/telemetry/errors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ errors }),
      });

      if (!response.ok) {
        console.warn('[Savvagent] Failed to send errors:', response.statusText);
      }
    } catch (error) {
      console.warn('[Savvagent] Error sending errors:', error);
    }
  }

  /**
   * Clean up resources
   */
  close(): void {
    this.closed = true;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}
