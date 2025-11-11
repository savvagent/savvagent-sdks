import { FlagUpdateEvent } from './types';

/**
 * Real-time updates service using Server-Sent Events (SSE)
 */
export class RealtimeService {
  private baseUrl: string;
  private apiKey: string;
  private eventSource: EventSource | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10; // Increased from 5 to 10
  private reconnectDelay: number = 1000; // Start with 1 second
  private maxReconnectDelay: number = 30000; // Cap at 30 seconds
  private listeners: Map<string, Set<(event: FlagUpdateEvent) => void>> = new Map();
  private onConnectionChange?: (connected: boolean) => void;

  constructor(
    baseUrl: string,
    apiKey: string,
    onConnectionChange?: (connected: boolean) => void
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.onConnectionChange = onConnectionChange;
  }

  /**
   * Connect to SSE stream
   */
  connect(): void {
    if (this.eventSource) {
      return; // Already connected
    }

    // Build SSE URL with API key
    const url = `${this.baseUrl}/api/flags/stream?apiKey=${encodeURIComponent(this.apiKey)}`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        console.log('[Savvagent] Real-time connection established');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.onConnectionChange?.call(null, true);
      };

      this.eventSource.onerror = (error) => {
        console.error('[Savvagent] SSE connection error:', error);
        this.handleDisconnect();
      };

      // Listen to heartbeat events (keep-alive from server)
      this.eventSource.addEventListener('heartbeat', () => {
        // Heartbeat received - connection is alive
        // No action needed, just prevents error logging
      });

      // Listen to all event types
      this.eventSource.addEventListener('flag.updated', (e) => {
        this.handleMessage('flag.updated', e);
      });

      this.eventSource.addEventListener('flag.deleted', (e) => {
        this.handleMessage('flag.deleted', e);
      });

      this.eventSource.addEventListener('flag.created', (e) => {
        this.handleMessage('flag.created', e);
      });
    } catch (error) {
      console.error('[Savvagent] Failed to create EventSource:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Handle incoming SSE messages
   */
  private handleMessage(type: FlagUpdateEvent['type'], event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      const updateEvent: FlagUpdateEvent = {
        type,
        flagKey: data.key,
        data,
      };

      // Notify specific flag listeners
      const flagListeners = this.listeners.get(updateEvent.flagKey);
      if (flagListeners) {
        flagListeners.forEach((listener) => listener(updateEvent));
      }

      // Notify wildcard listeners
      const wildcardListeners = this.listeners.get('*');
      if (wildcardListeners) {
        wildcardListeners.forEach((listener) => listener(updateEvent));
      }
    } catch (error) {
      console.error('[Savvagent] Failed to parse SSE message:', error);
    }
  }

  /**
   * Handle disconnection and attempt reconnect
   */
  private handleDisconnect(): void {
    this.onConnectionChange?.call(null, false);

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Attempt reconnect with exponential backoff (capped at maxReconnectDelay)
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const exponentialDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      const delay = Math.min(exponentialDelay, this.maxReconnectDelay);

      console.log(`[Savvagent] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.warn('[Savvagent] Max reconnection attempts reached. Connection will not be retried automatically.');
    }
  }

  /**
   * Subscribe to flag updates
   * @param flagKey - Specific flag key or '*' for all flags
   * @param listener - Callback function
   */
  subscribe(flagKey: string, listener: (event: FlagUpdateEvent) => void): () => void {
    if (!this.listeners.has(flagKey)) {
      this.listeners.set(flagKey, new Set());
    }

    this.listeners.get(flagKey)!.add(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(flagKey);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(flagKey);
        }
      }
    };
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    this.onConnectionChange?.call(null, false);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }
}
