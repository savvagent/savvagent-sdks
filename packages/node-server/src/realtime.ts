import EventSource from 'eventsource';
import { FlagUpdateEvent } from './types';

/**
 * Service for real-time flag updates via Server-Sent Events
 * Per SDK Developer Guide: GET /api/flags/stream with Authorization header
 */
export class RealtimeService {
  private baseUrl: string;
  private apiKey: string;
  private eventSource: EventSource | null = null;
  private subscribers: Map<string, Set<(event: FlagUpdateEvent) => void>> = new Map();
  private onConnectionChange: (connected: boolean) => void;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private reconnectTimeout: NodeJS.Timeout | null = null;

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
   * Per SDK Developer Guide: Use Authorization header, never pass API key in URL
   */
  connect(): void {
    // Per SDK Developer Guide: GET /api/flags/stream (no credentials in URL)
    const url = `${this.baseUrl}/api/flags/stream`;

    // eventsource package supports custom headers
    this.eventSource = new EventSource(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    this.eventSource.onopen = () => {
      console.log('[Savvagent] Real-time connection established');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.onConnectionChange(true);
    };

    this.eventSource.onerror = (error: unknown) => {
      console.warn('[Savvagent] SSE connection error:', error);
      this.handleDisconnect();
    };

    // Handle named events per SDK Developer Guide event types
    this.eventSource.addEventListener('connected', () => {
      console.log('[Savvagent] SSE connected event received');
    });

    this.eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received - connection is alive
    });

    this.eventSource.addEventListener('flag.created', (event: any) => {
      this.handleFlagEvent('flag.created', event);
    });

    this.eventSource.addEventListener('flag.updated', (event: any) => {
      this.handleFlagEvent('flag.updated', event);
    });

    this.eventSource.addEventListener('flag.deleted', (event: any) => {
      this.handleFlagEvent('flag.deleted', event);
    });

    // Fallback for generic messages
    this.eventSource.onmessage = (event: any) => {
      try {
        const data: FlagUpdateEvent = JSON.parse(event.data);
        this.notifySubscribers(data);
      } catch (error) {
        // Ignore parse errors for non-JSON messages (like heartbeats)
      }
    };
  }

  /**
   * Handle flag events
   */
  private handleFlagEvent(type: FlagUpdateEvent['type'], event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      const updateEvent: FlagUpdateEvent = {
        type,
        flagKey: data.key,
        data,
      };
      this.notifySubscribers(updateEvent);
    } catch (error) {
      console.warn('[Savvagent] Error parsing SSE event:', error);
    }
  }

  /**
   * Handle disconnection with exponential backoff reconnection
   */
  private handleDisconnect(): void {
    this.onConnectionChange(false);

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Attempt reconnect with exponential backoff
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const exponentialDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      const delay = Math.min(exponentialDelay, this.maxReconnectDelay);

      console.log(`[Savvagent] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      this.reconnectTimeout = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.warn('[Savvagent] Max reconnection attempts reached');
    }
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
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
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
