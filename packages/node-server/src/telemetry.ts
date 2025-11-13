import { EvaluationEvent, ErrorEvent } from './types';

/**
 * Service for tracking flag evaluations and errors
 */
export class TelemetryService {
  private baseUrl: string;
  private apiKey: string;
  private enabled: boolean;
  private eventQueue: (EvaluationEvent | ErrorEvent)[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
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
   */
  trackEvaluation(event: EvaluationEvent): void {
    if (!this.enabled) return;

    this.eventQueue.push(event);

    if (this.eventQueue.length >= this.BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Track an error in flagged code
   */
  trackError(event: ErrorEvent): void {
    if (!this.enabled) return;

    this.eventQueue.push(event);

    if (this.eventQueue.length >= this.BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Start auto-flushing events
   */
  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Flush events to the server
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      const response = await fetch(`${this.baseUrl}/api/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ events }),
      });

      if (!response.ok) {
        console.warn('[Savvagent] Failed to send telemetry:', response.statusText);
      }
    } catch (error) {
      console.warn('[Savvagent] Error sending telemetry:', error);
    }
  }

  /**
   * Clean up resources
   */
  close(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}
