import { FlagClient } from '../src/client';

/**
 * Browser path of the anonymous ID: the cookie set by server integrations
 * wins (and is mirrored to localStorage); without it, localStorage is used
 * as before.
 */
describe('FlagClient anonymous ID in the browser', () => {
  const g = globalThis as any;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    g.window = {};
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    g.document = { cookie: '' };
  });

  afterEach(() => {
    delete g.window;
    delete g.localStorage;
    delete g.document;
  });

  const make = () =>
    new FlagClient({ apiKey: 'sdk_test', enableRealtime: false, enableTelemetry: false });

  test('uses the savvagent_anonymous_id cookie when present and stores it', () => {
    store.set('savvagent_anonymous_id', 'anon_from_storage');
    g.document.cookie = 'other=1; savvagent_anonymous_id=server-id%2D1; x=y';
    const client = make();
    expect(client.getAnonymousId()).toBe('server-id-1');
    expect(store.get('savvagent_anonymous_id')).toBe('server-id-1');
  });

  test('falls back to localStorage when the cookie is absent', () => {
    store.set('savvagent_anonymous_id', 'anon_from_storage');
    g.document.cookie = 'other=1';
    expect(make().getAnonymousId()).toBe('anon_from_storage');
  });

  test('generates and stores a new ID when neither exists', () => {
    const id = make().getAnonymousId();
    expect(id).toMatch(/^anon_/);
    expect(store.get('savvagent_anonymous_id')).toBe(id);
  });
});
