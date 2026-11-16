import { FlagClient } from '../src/client';
import { RealtimeService } from '../src/realtime';

describe('FlagClient', () => {
  test('should throw error for invalid API key', () => {
    expect(() => {
      new FlagClient({ apiKey: 'invalid-key' });
    }).toThrow('Invalid API key');
  });

  test('should accept valid API key', () => {
    expect(() => {
      new FlagClient({ apiKey: 'sdk_test_key' });
    }).not.toThrow();
  });

  test('should apply default configuration', () => {
    const client = new FlagClient({
      apiKey: 'sdk_test_key',
    });

    expect(client).toBeDefined();
    // Client should be initialized with defaults
  });

  test('should accept custom configuration', () => {
    const client = new FlagClient({
      apiKey: 'sdk_test_key',
      baseUrl: 'https://custom.api.com',
      enableRealtime: false,
      enableTelemetry: false,
      cacheTtl: 30000,
      defaults: {
        'test-flag': true,
      },
    });

    expect(client).toBeDefined();
  });

  describe('base URL', () => {
    const originalFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ key: 'test-flag', enabled: true }),
      });
      global.fetch = fetchMock as any;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('defaults to https://api.savvagent.com/flags', async () => {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        enableTelemetry: false,
      });

      await client.evaluate('test-flag');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.savvagent.com/flags/api/flags/test-flag/evaluate'
      );
    });

    test('strips trailing slashes from a custom base URL', async () => {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        baseUrl: 'https://flags.example.com/flags//',
        enableRealtime: false,
        enableTelemetry: false,
      });

      await client.evaluate('test-flag');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://flags.example.com/flags/api/flags/test-flag/evaluate'
      );
    });
  });

  // Note: More comprehensive integration tests would require mocking fetch
  // and EventSource, which is beyond the scope of this basic test suite
});

describe('FlagClient evaluation cache (cross-user isolation, #22)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // Enabled only for user "alice"; every response carries a variation.
    fetchMock = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const enabled = body.context.user_id === 'alice';
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: 'flag', enabled, variation: enabled ? 'on' : 'off' }),
      };
    });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeClient(cacheTtl?: number) {
    return new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: false,
      enableTelemetry: false,
      retryAttempts: 1,
      ...(cacheTtl !== undefined ? { cacheTtl } : {}),
    });
  }

  test('same flag, two contexts: two API calls and two different results', async () => {
    const client = makeClient();
    const alice = await client.evaluate('flag', { user_id: 'alice' });
    const bob = await client.evaluate('flag', { user_id: 'bob' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(alice.value).toBe(true);
    expect(bob.value).toBe(false);
    client.close();
  });

  test('same context twice: one API call, cached result keeps metadata', async () => {
    const client = makeClient();
    const first = await client.evaluate('flag', { user_id: 'alice', attributes: { a: 1, b: 2 } });
    const second = await client.evaluate('flag', { attributes: { b: 2, a: 1 }, user_id: 'alice' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.reason).toBe('evaluated');
    expect(second.reason).toBe('cached');
    expect(second.value).toBe(true);
    expect(second.metadata?.variation).toBe('on');
    client.close();
  });

  test('clearing a flag (as realtime invalidation does) clears every context', async () => {
    const client = makeClient();
    await client.evaluate('flag', { user_id: 'alice' });
    await client.evaluate('flag', { user_id: 'bob' });
    (client as any).cache.invalidate('flag');
    await client.evaluate('flag', { user_id: 'alice' });
    await client.evaluate('flag', { user_id: 'bob' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    client.close();
  });

  test('cacheTtl: 0 never caches', async () => {
    const client = makeClient(0);
    await client.evaluate('flag', { user_id: 'alice' });
    await client.evaluate('flag', { user_id: 'alice' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.close();
  });

  test('cacheMaxEntries caps the cache across many distinct contexts', async () => {
    const client = new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: false,
      enableTelemetry: false,
      retryAttempts: 1,
      cacheMaxEntries: 5,
    });
    for (let i = 0; i < 50; i++) {
      await client.evaluate('flag', { user_id: `user-${i}` });
    }
    expect((client as any).cache.size).toBe(5);
    client.close();
  });

  test('getAllFlags does not seed the evaluation cache', async () => {
    const client = makeClient();
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ flags: [{ key: 'flag', enabled: true, scope: 'application', environments: {} }] }),
    }));
    await client.getAllFlags('development');
    const bob = await client.evaluate('flag', { user_id: 'bob' });
    expect(bob.value).toBe(false);
    expect(bob.reason).toBe('evaluated');
    client.close();
  });
});

describe('FlagClient flag key validation', () => {
  const baseUrl = 'https://flags.example.test';
  const invalidKeys = ['a/b', 'a?b', 'a#b', 'a%2Fb', '.', '..', '', 'bad key', 'clé', 'a'.repeat(129)];
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const makeClient = (onError: jest.Mock) =>
    new FlagClient({
      apiKey: 'sdk_test_key',
      baseUrl,
      enableRealtime: false,
      enableTelemetry: false,
      retryAttempts: 1,
      defaults: { 'a/b': true, '..': true },
      onError,
    });

  test.each(invalidKeys)('returns an error result with the default and no request for key %j', async (key) => {
    const onError = jest.fn();
    const client = makeClient(onError);

    const result = await client.evaluate(key);

    expect(result.key).toBe(key);
    expect(result.reason).toBe('error');
    expect(result.value).toBe(key === 'a/b' || key === '..');
    expect(result.metadata?.description).toMatch(/^Invalid flag key/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toMatch(/^Invalid flag key .*1-128 characters of \[A-Za-z0-9._-\]/);
    client.close();
  });

  test.each([undefined, null, 42, {}])('rejects the non-string key %p without throwing', async (key) => {
    const onError = jest.fn();
    const client = makeClient(onError);

    const result = await client.evaluate(key as unknown as string);

    expect(result.reason).toBe('error');
    expect(result.value).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('non-string value of type');
    client.close();
  });

  test('isEnabled returns the default for an invalid key without a request', async () => {
    const client = makeClient(jest.fn());
    await expect(client.isEnabled('a/b')).resolves.toBe(true);
    await expect(client.isEnabled('x/y')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    client.close();
  });

  test('fetches a valid key at exactly one path segment', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ key: 'k', enabled: true }) });
    const client = makeClient(jest.fn());

    await client.evaluate('new-checkout.v2_b');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${baseUrl}/api/flags/new-checkout.v2_b/evaluate`);
    client.close();
  });

  test('treats ... as a valid key', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ key: '...', enabled: true }) });
    const client = makeClient(jest.fn());

    await client.evaluate('...');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${baseUrl}/api/flags/.../evaluate`);
    client.close();
  });

  test('accepts a 128-character key', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ enabled: true }) });
    const client = makeClient(jest.fn());
    const key = 'a'.repeat(128);

    await client.evaluate(key);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${baseUrl}/api/flags/${key}/evaluate`);
    client.close();
  });
});

describe('FlagClient in-flight invalidation (stale re-cache guard)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeClient() {
    return new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: false,
      enableTelemetry: false,
      retryAttempts: 1,
    });
  }

  /**
   * The first request answers `enabled: true` but runs `during` while it is in
   * flight; every later request answers `enabled: false` (the kill switch).
   */
  function serveWithInvalidation(during: () => void) {
    let n = 0;
    fetchMock = jest.fn().mockImplementation(async () => {
      n++;
      const enabled = n === 1;
      if (n === 1) during();
      return { ok: true, status: 200, json: async () => ({ key: 'checkout', enabled }) };
    });
    global.fetch = fetchMock as any;
  }

  async function expectNotRecached(client: FlagClient) {
    const first = await client.evaluate('checkout', { user_id: 'a' });
    expect(first.value).toBe(true);
    expect((client as any).cache.size).toBe(0);
    const second = await client.evaluate('checkout', { user_id: 'a' });
    expect(second.reason).toBe('evaluated');
    expect(second.value).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.close();
  }

  test('a flag invalidation (as a realtime update does) during the request drops its result', async () => {
    const client = makeClient();
    serveWithInvalidation(() => (client as any).cache.invalidate('checkout'));
    await expectNotRecached(client);
  });

  test('a realtime update during the request drops its result', async () => {
    // Keep the subscription the client registers, but open no stream.
    const connect = jest.spyOn(RealtimeService.prototype, 'connect').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: true,
        enableTelemetry: false,
        retryAttempts: 1,
      });
      const realtime = (client as any).realtime;
      serveWithInvalidation(() =>
        realtime.handleMessage({ event: 'flag.updated', data: JSON.stringify({ key: 'checkout' }) })
      );
      await expectNotRecached(client);
    } finally {
      connect.mockRestore();
      log.mockRestore();
    }
  });

  test('clearCache during the request drops its result', async () => {
    const client = makeClient();
    serveWithInvalidation(() => client.clearCache());
    await expectNotRecached(client);
  });

  test('setting an override during the request drops its result', async () => {
    const client = makeClient();
    serveWithInvalidation(() => client.setOverride('checkout', true));
    const first = await client.evaluate('checkout', { user_id: 'a' });
    expect(first.reason).toBe('evaluated');
    expect((client as any).cache.size).toBe(0);
    client.close();
  });

  test('setting overrides in bulk during the request drops its result', async () => {
    const client = makeClient();
    serveWithInvalidation(() => client.setOverrides({ checkout: true }));
    await client.evaluate('checkout', { user_id: 'a' });
    expect((client as any).cache.size).toBe(0);
    client.close();
  });

  test('clearing an override during the request drops its result', async () => {
    const client = makeClient();
    serveWithInvalidation(() => client.clearOverride('checkout'));
    await expectNotRecached(client);
  });

  test('clearing all overrides during the request drops the result of an overridden flag', async () => {
    const client = makeClient();
    serveWithInvalidation(() => {
      client.setOverride('checkout', true);
      client.clearAllOverrides();
    });
    await expectNotRecached(client);
  });

  test('invalidating a different flag during the request still caches the result', async () => {
    const client = makeClient();
    serveWithInvalidation(() => (client as any).cache.invalidate('other'));
    await client.evaluate('checkout', { user_id: 'a' });
    const second = await client.evaluate('checkout', { user_id: 'a' });
    expect(second.reason).toBe('cached');
    expect(second.value).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.close();
  });
});
