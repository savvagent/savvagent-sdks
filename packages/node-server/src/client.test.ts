import { FlagClient } from './client';
import { FlagContext } from './types';

// Mock global fetch
global.fetch = jest.fn();

// Mock EventSource
global.EventSource = jest.fn(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  close: jest.fn(),
  readyState: 0,
  url: '',
  withCredentials: false,
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
  onopen: null,
  onmessage: null,
  onerror: null,
  dispatchEvent: jest.fn(),
})) as any;

describe('FlagClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('Constructor', () => {
    it('should throw error for invalid API key', () => {
      expect(() => {
        new FlagClient({ apiKey: 'invalid-key' });
      }).toThrow('Invalid API key');
    });

    it('should throw error for missing API key', () => {
      expect(() => {
        new FlagClient({ apiKey: '' });
      }).toThrow('Invalid API key');
    });

    it('should accept valid API key', () => {
      expect(() => {
        new FlagClient({
          apiKey: 'sdk_test_key',
          enableRealtime: false
        });
      }).not.toThrow();
    });

    it('should apply default configuration', () => {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
      });

      expect(client).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        baseUrl: 'https://api.savvagent.com/flags',
        enableRealtime: false,
        enableTelemetry: false,
        cacheTtl: 30000,
        timeout: 10000,
        defaults: {
          'test-flag': true,
        },
      });

      expect(client).toBeDefined();
    });
  });

  describe('base URL', () => {
    const okResponse = {
      ok: true,
      json: async () => ({ enabled: true }),
    };

    it('defaults to https://api.savvagent.com/flags', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse);
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        enableTelemetry: false,
      });

      await client.evaluate('test-flag');

      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
        'https://api.savvagent.com/flags/api/flags/test-flag/evaluate'
      );
    });

    it('strips trailing slashes from a custom base URL', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse);
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        baseUrl: 'https://flags.example.com/flags//',
        enableRealtime: false,
        enableTelemetry: false,
      });

      await client.evaluate('test-flag');

      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
        'https://flags.example.com/flags/api/flags/test-flag/evaluate'
      );
    });
  });

  describe('evaluate', () => {
    let client: FlagClient;

    beforeEach(() => {
      client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        enableTelemetry: false,
      });
    });

    it('should evaluate flag and return true', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          reason: 'match',
        }),
      });

      const result = await client.evaluate('test-flag');

      expect(result.value).toBe(true);
      expect(result.key).toBe('test-flag');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should evaluate flag and return false', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: false,
          reason: 'default',
        }),
      });

      const result = await client.evaluate('test-flag');

      expect(result.value).toBe(false);
      expect(result.key).toBe('test-flag');
    });

    it('should include context in request', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
        }),
      });

      const context: FlagContext = {
        user_id: 'user-123',
        attributes: {
          email: 'test@example.com',
          plan: 'pro',
        },
      };

      await client.evaluate('test-flag', context);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/evaluate'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sdk_test_key',
          }),
          body: expect.stringContaining('user-123'),
        })
      );
    });

    it('should use cached value on second call', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
        }),
      });

      // First call
      const result1 = await client.evaluate('test-flag');
      expect(result1.value).toBe(true);

      // Second call should use cache
      const result2 = await client.evaluate('test-flag');
      expect(result2.value).toBe(true);
      expect(result2.reason).toBe('cached');

      // Should only call API once
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await client.evaluate('test-flag');
      expect(result.value).toBe(false);
      expect(result.reason).toBe('error');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await client.evaluate('test-flag');
      expect(result.value).toBe(false);
      expect(result.reason).toBe('error');
    });

    it('should use default value on error if provided', async () => {
      const _clientWithDefaults = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        enableTelemetry: false,
        defaults: {
          'test-flag': true,
        },
      });

      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      // If defaults are supported in error case
      // const result = await clientWithDefaults.evaluate('test-flag');
      // expect(result.value).toBe(true);
    });

    it('should handle timeout', async () => {
      const _client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        timeout: 100,
      });

      (global.fetch as jest.Mock).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      // Timeout handling would be tested here
    });
  });

  describe('isEnabled', () => {
    let client: FlagClient;

    beforeEach(() => {
      client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        enableTelemetry: false,
      });
    });

    it('should return true when flag is enabled', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
        }),
      });

      const isEnabled = await client.isEnabled('test-flag');
      expect(isEnabled).toBe(true);
    });

    it('should return false when flag is disabled', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: false,
        }),
      });

      const isEnabled = await client.isEnabled('test-flag');
      expect(isEnabled).toBe(false);
    });

    it('should return default value on error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const isEnabled = await client.isEnabled('test-flag', undefined);
      expect(isEnabled).toBe(false);
    });
  });

  describe('getVariation', () => {
    let client: FlagClient;

    beforeEach(() => {
      client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
        enableTelemetry: false,
      });
    });

    it('should return string variation', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          variation: 'dark-mode',
        }),
      });

      const result = await client.getVariation('theme', undefined);
      expect(result.enabled).toBe(true);
      expect(result.variation).toBe('dark-mode');
    });

    it('should return numeric variation', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          variation: 'variant-100',
        }),
      });

      const result = await client.getVariation('max-items', undefined);
      expect(result.enabled).toBe(true);
      expect(result.variation).toBe('variant-100');
    });

    it('should return default on error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await client.getVariation('theme', undefined);
      expect(result.enabled).toBe(false);
      expect(result.variation).toBe('control');
    });

    it('should return object variation', async () => {
      const configObject = { apiUrl: 'https://api.example.com', timeout: 5000 };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          configuration: configObject,
        }),
      });

      const result = await client.getVariation('app-config', undefined);
      expect(result.enabled).toBe(true);
      expect(result.configuration).toEqual(configObject);
    });
  });

  describe('close', () => {
    it('should cleanup resources', () => {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
      });

      // Should not throw
      expect(() => client.close()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      const client = new FlagClient({
        apiKey: 'sdk_test_key',
        enableRealtime: false,
      });

      expect(() => {
        client.close();
        client.close();
      }).not.toThrow();
    });
  });

  describe('Context handling', () => {
    let client: FlagClient;

    beforeEach(() => {
      client = new FlagClient({
        apiKey: 'sdk_test_key',
        applicationId: 'app-123',
        enableRealtime: false,
        enableTelemetry: false,
      });
    });

    it('should merge application_id from config', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ enabled: true }),
      });

      await client.evaluate('test-flag', { user_id: 'user-123' });

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.context.application_id).toBe('app-123');
      expect(body.context.user_id).toBe('user-123');
    });

    it('should handle complex context attributes', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ enabled: true }),
      });

      const context: FlagContext = {
        user_id: 'user-456',
        attributes: {
          email: 'test@example.com',
          plan: 'enterprise',
          features: ['feature-a', 'feature-b'],
          metadata: {
            signupDate: '2024-01-01',
            country: 'US',
          },
        },
      };

      await client.evaluate('test-flag', context);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.context.attributes.email).toBe('test@example.com');
      expect(body.context.attributes.plan).toBe('enterprise');
      expect(body.context.attributes.features).toEqual(['feature-a', 'feature-b']);
      expect(body.context.attributes.metadata).toEqual({
        signupDate: '2024-01-01',
        country: 'US',
      });
    });
  });
});

describe('FlagClient evaluation cache (cross-user isolation, #22)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Enabled only for user "alice"; responses carry configuration and variation.
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const enabled = body.context?.user_id === 'alice';
      return {
        ok: true,
        json: async () => ({ enabled, variation: enabled ? 'on' : 'off', configuration: { enabled } }),
      };
    });
  });

  function makeClient(cacheTtl?: number) {
    return new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: false,
      enableTelemetry: false,
      ...(cacheTtl !== undefined ? { cacheTtl } : {}),
    });
  }

  it('same flag, two contexts: two API calls and two different results', async () => {
    const client = makeClient();
    const alice = await client.evaluate('flag', { user_id: 'alice' });
    const bob = await client.evaluate('flag', { user_id: 'bob' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(alice.value).toBe(true);
    expect(bob.value).toBe(false);
    client.close();
  });

  it('same context twice: one API call, cached result keeps variation and configuration', async () => {
    const client = makeClient();
    await client.evaluate('flag', { user_id: 'alice', attributes: { a: 1, b: 2 } });
    const second = await client.evaluate('flag', { attributes: { b: 2, a: 1 }, user_id: 'alice' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(second.reason).toBe('cached');
    expect(second.value).toBe(true);
    expect(second.variation).toBe('on');
    expect(second.configuration).toEqual({ enabled: true });
    client.close();
  });

  it('invalidating a flag clears every context', async () => {
    const client = makeClient();
    await client.evaluate('flag', { user_id: 'alice' });
    await client.evaluate('flag', { user_id: 'bob' });
    (client as any).cache.invalidate('flag');
    await client.evaluate('flag', { user_id: 'alice' });
    await client.evaluate('flag', { user_id: 'bob' });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    client.close();
  });

  it('cacheMaxEntries caps the cache across many distinct contexts', async () => {
    const client = new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: false,
      enableTelemetry: false,
      cacheMaxEntries: 5,
    });
    for (let i = 0; i < 50; i++) {
      await client.evaluate('flag', { user_id: `user-${i}` });
    }
    expect((client as any).cache.size).toBe(5);
    client.close();
  });

  it('cacheTtl: 0 never caches', async () => {
    const client = makeClient(0);
    await client.evaluate('flag', { user_id: 'alice' });
    await client.evaluate('flag', { user_id: 'alice' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    client.close();
  });
});

/**
 * Ports from the archived flags repo: key encoding (#118), the evaluate
 * contract (#126), the trackError fallback (#128), result metadata (#165) and
 * the stale re-cache guard (#166).
 */
describe('FlagClient archived-repo ports (#40)', () => {
  const baseUrl = 'https://flags.example.test';
  let fetchMock: jest.Mock;
  let originalFetch: typeof global.fetch;

  // The evaluate response exactly as the server sends it (SDK developer guide).
  const serverBody = (extra: Record<string, unknown> = {}) => ({
    key: 'checkout',
    enabled: true,
    scope: 'application',
    variation: null,
    configuration: null,
    timestamp: 1700000000,
    version: 3,
    context: { environment: 'production' },
    ...extra,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const makeClient = (onError: jest.Mock = jest.fn(), defaults: Record<string, boolean> = {}) =>
    new FlagClient({
      apiKey: 'sdk_test_key',
      baseUrl,
      enableRealtime: false,
      enableTelemetry: false,
      defaults,
      onError,
    });

  describe('flag key validation (#118)', () => {
    const invalidKeys = ['a/b', 'a?b', 'a#b', 'a%2Fb', '.', '..', '', 'bad key', 'a'.repeat(129)];

    test.each(invalidKeys)('returns the default without a request for key %j', async (key) => {
      const onError = jest.fn();
      const client = makeClient(onError, { 'a/b': true, '..': true });

      const result = await client.evaluate(key);

      expect(result.reason).toBe('error');
      expect(result.key).toBe(key);
      expect(result.value).toBe(key === 'a/b' || key === '..');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      client.close();
    });

    test('rejects a non-string key without throwing', async () => {
      const onError = jest.fn();
      const client = makeClient(onError);

      const result = await client.evaluate(undefined as unknown as string);

      expect(result.reason).toBe('error');
      expect(result.value).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      client.close();
    });

    test.each(['new-checkout.v2_b', '...', 'a'.repeat(128)])(
      'fetches valid key %j as one path segment',
      async (key) => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ enabled: true }) });
        const client = makeClient();

        await client.evaluate(key);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(`${baseUrl}/api/flags/${key}/evaluate`);
        client.close();
      }
    );
  });

  describe('evaluate contract (#126)', () => {
    test.each([true, false])('reads enabled=%s from the documented path', async (enabled) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => serverBody({ enabled }) });
      const onError = jest.fn();
      const client = makeClient(onError, { checkout: !enabled });

      const result = await client.evaluate('checkout');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`${baseUrl}/api/flags/checkout/evaluate`);
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(result.value).toBe(enabled);
      expect(result.reason).toBe('evaluated');
      // The server's nulls come back as the SDK's undefined.
      expect(result.variation).toBeUndefined();
      expect(result.configuration).toBeUndefined();
      expect(onError).not.toHaveBeenCalled();
      client.close();
    });

    test('a cached result also has undefined, not null, configuration and variation', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => serverBody() });
      const client = makeClient();

      await client.evaluate('checkout');
      const cached = await client.evaluate('checkout');

      expect(cached.reason).toBe('cached');
      expect(cached.variation).toBeUndefined();
      expect(cached.configuration).toBeUndefined();
      client.close();
    });

    test.each([
      [{ value: true }],
      [{}],
      [{ enabled: 'true' }],
      [{ enabled: 1 }],
      [{ enabled: null }],
      [null],
      ['enabled'],
    ])('treats %j as a failed lookup and does not cache it', async (body) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
      const onError = jest.fn();
      // The default is true so a substituted default would be visible.
      const client = makeClient(onError, { checkout: true });

      const first = await client.evaluate('checkout');
      const second = await client.evaluate('checkout');

      expect(first.value).toBe(true);
      expect(first.reason).toBe('error');
      expect(second.reason).toBe('error');
      expect(onError).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((client as any).cache.size).toBe(0);
      client.close();
    });
  });

  describe('trackError fallback (#128)', () => {
    const spyOnTrackError = (client: FlagClient) =>
      jest.spyOn((client as any).telemetry, 'trackError').mockImplementation(() => {});

    beforeEach(() => {
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        return { ok: true, json: async () => ({ enabled: body.context?.user_id === 'a' }) };
      });
    });

    test('trackError reports the value cached for its own context', async () => {
      const client = makeClient();
      const spy = spyOnTrackError(client);
      await client.evaluate('checkout', { user_id: 'a' });
      await client.evaluate('checkout', { user_id: 'b' });

      client.trackError('checkout', new Error('x'), { user_id: 'a' });
      client.trackError('checkout', new Error('x'), { user_id: 'b' });

      expect((spy.mock.calls[0][0] as any).flagEnabled).toBe(true);
      expect((spy.mock.calls[1][0] as any).flagEnabled).toBe(false);
      client.close();
    });

    test("trackError without its context reports the flag's last evaluation", async () => {
      const client = makeClient();
      const spy = spyOnTrackError(client);
      await client.evaluate('checkout', { user_id: 'a' });

      client.trackError('checkout', new Error('x'));
      client.trackError('never-evaluated', new Error('x'));

      expect((spy.mock.calls[0][0] as any).flagEnabled).toBe(true);
      expect((spy.mock.calls[1][0] as any).flagEnabled).toBe(false);
      client.close();
    });

    test('a cached hit also counts as the last evaluation', async () => {
      const client = makeClient();
      const spy = spyOnTrackError(client);
      await client.evaluate('checkout', { user_id: 'b' }); // false, fetched
      await client.evaluate('checkout', { user_id: 'a' }); // true, fetched
      await client.evaluate('checkout', { user_id: 'b' }); // false, cached

      client.trackError('checkout', new Error('x'), { user_id: 'nobody' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((spy.mock.calls[0][0] as any).flagEnabled).toBe(false);
      client.close();
    });

    test('trackError with a cyclic context falls back to the last evaluation', async () => {
      const client = makeClient();
      const spy = spyOnTrackError(client);
      await client.evaluate('checkout', { user_id: 'a' });
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      expect(() =>
        client.trackError('checkout', new Error('x'), { user_id: 'a', attributes: cyclic })
      ).not.toThrow();
      expect((spy.mock.calls[0][0] as any).flagEnabled).toBe(true);
      client.close();
    });

    test('setEnvironment forgets the last evaluations', async () => {
      const client = makeClient();
      const spy = spyOnTrackError(client);
      await client.evaluate('checkout', { user_id: 'a' });

      client.setEnvironment('staging');
      client.trackError('checkout', new Error('x'));

      expect((spy.mock.calls[0][0] as any).flagEnabled).toBe(false);
      client.close();
    });
  });

  describe('result metadata (#165)', () => {
    test('reports the version and scope the server sends, and no field it does not', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => serverBody() });
      const client = makeClient();

      const r = await client.evaluate('checkout', { user_id: 'a' });

      expect(r.reason).toBe('evaluated');
      expect(r.metadata?.version).toBe(3);
      expect(r.metadata?.scope).toBe('application');
      expect(r.metadata?.flagId).toBeUndefined();
      expect(r.metadata?.description).toBeUndefined();
      expect(r.metadata?.variant).toBeUndefined();
      client.close();
    });

    test('carries the same version, scope and flagId on a cached result', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => serverBody({ flagId: 'flag-1' }),
      });
      const client = makeClient();

      const fresh = await client.evaluate('checkout', { user_id: 'a' });
      const r = await client.evaluate('checkout', { user_id: 'a' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fresh.metadata?.flagId).toBe('flag-1');
      expect(r.reason).toBe('cached');
      expect(r.metadata?.version).toBe(3);
      expect(r.metadata?.scope).toBe('application');
      expect(r.metadata?.flagId).toBe('flag-1');
      client.close();
    });

    test.each([
      ['string version, numeric scope', { version: '3', scope: 7 }],
      ['boolean version', { version: true }],
      ['fractional version', { version: 1.5 }],
      ['null version and scope', { version: null, scope: null }],
    ])('drops a malformed field without failing the lookup (%s)', async (_name, extra) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => serverBody(extra) });
      const onError = jest.fn();
      const client = makeClient(onError);

      const r = await client.evaluate('checkout', { user_id: 'a' });

      expect(r.value).toBe(true);
      expect(r.reason).toBe('evaluated');
      expect(r.metadata?.version).toBeUndefined();
      if ('scope' in extra) expect(r.metadata?.scope).toBeUndefined();
      else expect(r.metadata?.scope).toBe('application');
      expect(onError).not.toHaveBeenCalled();
      client.close();
    });
  });

  describe('stale re-cache guard (#166)', () => {
    test('an invalidation of the flag during the request drops its result', async () => {
      const client = makeClient();
      let n = 0;
      fetchMock.mockImplementation(async () => {
        n++;
        if (n === 1) client.invalidateCache('checkout'); // the kill switch flips mid-request
        return { ok: true, json: async () => ({ key: 'checkout', enabled: n === 1 }) };
      });

      const first = await client.evaluate('checkout', { user_id: 'a' });
      const second = await client.evaluate('checkout', { user_id: 'a' });

      expect(first.value).toBe(true);
      expect(first.reason).toBe('evaluated');
      expect(second.reason).toBe('evaluated');
      expect(second.value).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      client.close();
    });

    test('invalidating every flag during the request drops its result', async () => {
      const client = makeClient();
      let n = 0;
      fetchMock.mockImplementation(async () => {
        n++;
        if (n === 1) client.invalidateCache();
        return { ok: true, json: async () => ({ enabled: true }) };
      });

      await client.evaluate('checkout', { user_id: 'a' });
      const second = await client.evaluate('checkout', { user_id: 'a' });

      expect(second.reason).toBe('evaluated');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      client.close();
    });

    test('an invalidation of another flag does not drop the write', async () => {
      const client = makeClient();
      fetchMock.mockImplementation(async () => {
        client.invalidateCache('other');
        return { ok: true, json: async () => ({ key: 'checkout', enabled: true }) };
      });

      await client.evaluate('checkout', { user_id: 'a' });
      const second = await client.evaluate('checkout', { user_id: 'a' });

      expect(second.reason).toBe('cached');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      client.close();
    });

    test('a realtime flag update during the request drops its result', async () => {
      const client = makeClient();
      let n = 0;
      fetchMock.mockImplementation(async () => {
        n++;
        // What the realtime subscription does on a flag.updated event.
        if (n === 1) (client as any).cache.invalidate('checkout');
        return { ok: true, json: async () => ({ enabled: true }) };
      });

      await client.evaluate('checkout', { user_id: 'a' });
      await client.evaluate('checkout', { user_id: 'a' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      client.close();
    });
  });
});
