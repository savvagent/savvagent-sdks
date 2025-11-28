import { fetchEventSource, EventSourceMessage } from '@microsoft/fetch-event-source';
import { FlagUpdateEvent } from './types';

/**
 * Error class to signal that fetchEventSource should not retry
 */
class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

/**
 * Error class to signal that fetchEventSource can retry
 */
class RetriableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetriableError';
  }
}

/**
 * Real-time updates service using Server-Sent Events (SSE)
 * Uses @microsoft/fetch-event-source to support custom headers for authentication
 * (native EventSource doesn't support custom headers)
 */
export class RealtimeService {
  private baseUrl: string;
  private apiKey: string;
  private abortController: AbortController | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000; // Start with 1 second
  private maxReconnectDelay: number = 30000; // Cap at 30 seconds
  private listeners: Map<string, Set<(event: FlagUpdateEvent) => void>> = new Map();
  private onConnectionChange?: (connected: boolean) => void;
  private connected: boolean = false;
  private authFailed: boolean = false; // Track auth failures to prevent reconnection attempts

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
   * Connect to SSE stream using header-based authentication
   * Per SDK Developer Guide: "Never pass API keys as query parameters"
   */
  connect(): void {
    if (this.abortController) {
      return; // Already connected
    }

    // Don't attempt to connect if auth has already failed
    if (this.authFailed) {
      return;
    }

    this.abortController = new AbortController();

    // Build SSE URL - no credentials in URL per security best practices
    const url = `${this.baseUrl}/api/flags/stream`;

    fetchEventSource(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      signal: this.abortController.signal,
      // Disable built-in retry behavior - we handle it ourselves
      openWhenHidden: false,

      onopen: async (response) => {
        if (response.ok) {
          console.log('[Savvagent] Real-time connection established');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.connected = true;
          this.onConnectionChange?.(true);
        } else if (response.status === 401 || response.status === 403) {
          // Auth failed - don't retry
          this.authFailed = true;
          console.error(`[Savvagent] SSE authentication failed (${response.status}). Check your API key. Reconnection disabled.`);
          // Throwing FatalError prevents fetchEventSource from retrying
          throw new FatalError(`SSE authentication failed: ${response.status}`);
        } else {
          console.error(`[Savvagent] SSE connection failed: ${response.status}`);
          throw new RetriableError(`SSE connection failed: ${response.status}`);
        }
      },

      onmessage: (event: EventSourceMessage) => {
        this.handleMessage(event);
      },

      onerror: (err) => {
        // If auth failed, don't retry
        if (this.authFailed) {
          throw err; // Stop retrying
        }
        console.error('[Savvagent] SSE connection error:', err);
        this.handleDisconnect();
        // Don't throw - let fetchEventSource retry (unless it's auth failure)
      },

      onclose: () => {
        console.log('[Savvagent] SSE connection closed');
        if (!this.authFailed) {
          this.handleDisconnect();
        }
      },
    }).catch((error) => {
      // Connection was aborted or failed permanently
      if (error.name !== 'AbortError' && !(error instanceof FatalError)) {
        console.error('[Savvagent] SSE connection error:', error);
        if (!this.authFailed) {
          this.handleDisconnect();
        }
      }
    });
  }

  /**
   * Handle incoming SSE messages
   */
  private handleMessage(event: EventSourceMessage): void {
    // Handle heartbeat events
    if (event.event === 'heartbeat') {
      return;
    }

    // Handle connected event
    if (event.event === 'connected') {
      return;
    }

    // Handle flag events
    const eventType = event.event as FlagUpdateEvent['type'];
    if (!['flag.updated', 'flag.deleted', 'flag.created'].includes(eventType)) {
      return;
    }

    try {
      const data = JSON.parse(event.data);
      const updateEvent: FlagUpdateEvent = {
        type: eventType,
        flagKey: data.key,
        data,
      };

      // IMPORTANT: Notify wildcard listeners FIRST so cache is invalidated
      // before specific listeners trigger re-evaluation
      const wildcardListeners = this.listeners.get('*');
      if (wildcardListeners) {
        wildcardListeners.forEach((listener) => listener(updateEvent));
      }

      // Then notify specific flag listeners (which may trigger re-fetch)
      const flagListeners = this.listeners.get(updateEvent.flagKey);
      if (flagListeners) {
        flagListeners.forEach((listener) => listener(updateEvent));
      }
    } catch (error) {
      console.error('[Savvagent] Failed to parse SSE message:', error);
    }
  }

  /**
   * Handle disconnection and attempt reconnect with exponential backoff
   */
  private handleDisconnect(): void {
    this.connected = false;
    this.onConnectionChange?.(false);

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Don't attempt reconnect if auth has failed
    if (this.authFailed) {
      console.warn('[Savvagent] Authentication failed. Reconnection disabled.');
      return;
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
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.connected = false;
    this.onConnectionChange?.(false);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}
