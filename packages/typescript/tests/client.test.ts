import { FlagClient } from '../src/client';

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
