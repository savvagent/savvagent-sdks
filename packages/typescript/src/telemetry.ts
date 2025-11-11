import { EvaluationEvent, ErrorEvent } from './types';

/**
 * Telemetry service for tracking flag evaluations and errors
 */
export class TelemetryService {
  private baseUrl: string;
  private apiKey: string;
  private enabled: boolean;
  private queue: (EvaluationEvent | ErrorEvent)[] = [];
  private flushInterval: number = 5000; // 5 seconds
  private maxBatchSize: number = 50;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(baseUrl: string, apiKey: string, enabled: boolean = true) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.enabled = enabled;

    if (this.enabled) {
      this.startBatchSender();
    }
  }

  /**
   * Track a flag evaluation
   */
  trackEvaluation(event: EvaluationEvent): void {
    if (!this.enabled) return;

    this.queue.push(event);

    // Flush if batch is full
    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Track an error in flagged code
   */
  trackError(event: ErrorEvent): void {
    if (!this.enabled) return;

    this.queue.push(event);

    // Flush errors immediately (critical telemetry)
    this.flush();
  }

  /**
   * Start the batch sender interval
   */
  private startBatchSender(): void {
    this.timer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, this.flushInterval);

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush();
      });
    }
  }

  /**
   * Flush the telemetry queue
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.maxBatchSize);

    try {
      // Separate evaluations and errors
      const evaluations = batch.filter((e) => 'durationMs' in e) as EvaluationEvent[];
      const errors = batch.filter((e) => 'errorType' in e) as ErrorEvent[];

      // Send evaluations
      if (evaluations.length > 0) {
        await this.sendEvaluations(evaluations);
      }

      // Send errors
      if (errors.length > 0) {
        await this.sendErrors(errors);
      }
    } catch (error) {
      // Re-queue failed events (with limit to prevent infinite growth)
      if (this.queue.length < 1000) {
        this.queue.unshift(...batch);
      }
      console.error('[Savvagent] Failed to send telemetry:', error);
    }
  }

  /**
   * Send evaluation events to backend
   */
  private async sendEvaluations(events: EvaluationEvent[]): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/telemetry/evaluations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send evaluations: ${response.status}`);
    }
  }

  /**
   * Send error events to backend
   */
  private async sendErrors(events: ErrorEvent[]): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/telemetry/errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send errors: ${response.status}`);
    }
  }

  /**
   * Stop the telemetry service
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush(); // Final flush
  }

  /**
   * Generate a trace ID for distributed tracing
   */
  static generateTraceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
