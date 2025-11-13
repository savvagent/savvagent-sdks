declare module 'eventsource' {
  export default class EventSource {
    constructor(url: string);
    onopen: (() => void) | null;
    onerror: ((error: any) => void) | null;
    onmessage: ((event: any) => void) | null;
    close(): void;
  }
}
