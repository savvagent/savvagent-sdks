import EventSource from 'eventsource';
import { FlagUpdateEvent } from './types';

/**
 * Service for real-time flag updates via Server-Sent Events
 */
export class RealtimeService {
  private baseUrl: string;
  private apiKey: string;
  private eventSource: EventSource | null = null;
  private subscribers: Map<string, Set<(event: FlagUpdateEvent) => void>> = new Map();
  private onConnectionChange: (connected: boolean) => void;

  constructor(
    baseUrl: string,
    apiKey: string,
    onConnectionChange: (connected: boolean) => void = () => {}
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.onConnectionChange = onConnectionChange;
  }

  /**
   * Connect to the SSE stream
   */
  connect(): void {
    const url = `${this.baseUrl}/api/realtime?apiKey=${this.apiKey}`;

    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      this.onConnectionChange(true);
    };

    this.eventSource.onerror = (error: unknown) => {
      console.warn('[Savvagent] SSE connection error:', error);
      this.onConnectionChange(false);
    };

    this.eventSource.onmessage = (event: any) => {
      try {
        const data: FlagUpdateEvent = JSON.parse(event.data);
        this.notifySubscribers(data);
      } catch (error) {
        console.warn('[Savvagent] Error parsing SSE event:', error);
      }
    };
  }

  /**
   * Subscribe to flag updates
   */
  subscribe(flagKey: string, callback: (event: FlagUpdateEvent) => void): () => void {
    if (!this.subscribers.has(flagKey)) {
      this.subscribers.set(flagKey, new Set());
    }

    this.subscribers.get(flagKey)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(flagKey);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(flagKey);
        }
      }
    };
  }

  /**
   * Notify all subscribers of an event
   */
  private notifySubscribers(event: FlagUpdateEvent): void {
    // Notify specific flag subscribers
    const callbacks = this.subscribers.get(event.flagKey);
    if (callbacks) {
      callbacks.forEach(callback => callback(event));
    }

    // Notify wildcard subscribers
    const wildcardCallbacks = this.subscribers.get('*');
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach(callback => callback(event));
    }
  }

  /**
   * Disconnect from the SSE stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.onConnectionChange(false);
    }
  }

  /**
   * Clean up resources
   */
  close(): void {
    this.disconnect();
    this.subscribers.clear();
  }
}
