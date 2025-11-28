/**
 * Type declarations for eventsource package v2.x
 * The eventsource package supports custom headers through init options
 */
declare module 'eventsource' {
  interface EventSourceInitDict {
    headers?: Record<string, string>;
    https?: Record<string, unknown>;
    proxy?: string;
    withCredentials?: boolean;
  }

  interface MessageEvent {
    data: string;
    lastEventId: string;
    origin: string;
    type: string;
  }

  interface EventSourceEventMap {
    error: Event;
    message: MessageEvent;
    open: Event;
  }

  class EventSource {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSED: 2;

    readonly readyState: number;
    readonly url: string;
    readonly withCredentials: boolean;

    onopen: ((this: EventSource, event: Event) => void) | null;
    onmessage: ((this: EventSource, event: MessageEvent) => void) | null;
    onerror: ((this: EventSource, event: Event | unknown) => void) | null;

    constructor(url: string, eventSourceInitDict?: EventSourceInitDict);

    addEventListener<K extends keyof EventSourceEventMap>(
      type: K,
      listener: (event: EventSourceEventMap[K]) => void
    ): void;
    addEventListener(
      type: string,
      listener: (event: MessageEvent) => void
    ): void;

    removeEventListener<K extends keyof EventSourceEventMap>(
      type: K,
      listener: (event: EventSourceEventMap[K]) => void
    ): void;
    removeEventListener(
      type: string,
      listener: (event: MessageEvent) => void
    ): void;

    close(): void;
  }

  export = EventSource;
}
