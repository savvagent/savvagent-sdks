import { FlagClient } from './client';
import { defaultFromEnv } from './defaults';
import * as nodeServer from './index';

// #31 and #44: parity with the Rust server SDK.

global.fetch = jest.fn();

function mockEvaluate(enabled: boolean, extra: Record<string, unknown> = {}) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ enabled, ...extra }),
  });
}

function client(config: Partial<ConstructorParameters<typeof FlagClient>[0]> = {}): FlagClient {
  return new FlagClient({
    apiKey: 'sdk_test',
    enableRealtime: false,
    enableTelemetry: false,
    ...config,
  });
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('defaultFromEnv (#31)', () => {
  test.each([
    ['1', true],
    ['true', true],
    [' YES ', true],
    ['On', true],
    ['0', false],
    ['FALSE', false],
    ['no', false],
    [' off\n', false],
  ])('reads %j as %s', (raw, expected) => {
    expect(defaultFromEnv('FLAG', { FLAG: raw })()).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  test('an unset variable is ignored silently', () => {
    expect(defaultFromEnv('FLAG', {})()).toBeUndefined();
    expect(defaultFromEnv('toString', {})()).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test.each(['', 'maybe', 'enabled', 'secret-value'])(
    'ignores %j with a warning that names the variable but not its value',
    (raw) => {
      expect(defaultFromEnv('NEW_CHECKOUT', { NEW_CHECKOUT: raw })()).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toBe(
        'Savvagent Flags: environment variable "NEW_CHECKOUT" is not a boolean; ignoring it'
      );
      if (raw) expect(message).not.toContain(raw);
    }
  );

  test('reads process.env by default', () => {
    process.env.SAVVAGENT_TEST_DEFAULT_FROM_ENV = 'yes';
    try {
      expect(defaultFromEnv('SAVVAGENT_TEST_DEFAULT_FROM_ENV')()).toBe(true);
    } finally {
      delete process.env.SAVVAGENT_TEST_DEFAULT_FROM_ENV;
    }
  });

  test('is exported from the package', () => {
    expect(nodeServer.defaultFromEnv).toBe(defaultFromEnv);
  });
});

describe('defaultsFrom (#31)', () => {
  test('an env-derived default is used when evaluation fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('down'));
    const c = client({
      onError: () => {},
      defaultsFrom: { 'new-checkout': defaultFromEnv('NEW_CHECKOUT', { NEW_CHECKOUT: 'true' }) },
    });
    const result = await c.evaluate('new-checkout');
    expect(result).toMatchObject({ value: true, reason: 'error' });
  });

  test('each function runs once, when the client is built', async () => {
    const fn = jest.fn(() => true);
    const c = client({ onError: () => {}, defaultsFrom: { flag: fn } });
    expect(fn).toHaveBeenCalledTimes(1);
    (global.fetch as jest.Mock).mockRejectedValue(new Error('down'));
    await c.isEnabled('flag');
    await c.isEnabled('flag');
    c.isEnabledCached('flag');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('true or false replaces `defaults`; anything else leaves it in place', () => {
    const c = client({
      defaults: { a: true, b: true, c: true },
      defaultsFrom: {
        a: () => false,
        b: () => undefined,
        c: () => 'yes' as unknown as boolean,
        d: () => true,
      },
    });
    expect(c.isEnabledCached('a')).toBe(false);
    expect(c.isEnabledCached('b')).toBe(true);
    expect(c.isEnabledCached('c')).toBe(true);
    expect(c.isEnabledCached('d')).toBe(true);
    expect(c.isEnabledCached('e')).toBe(false);
  });

  test('the caller’s `defaults` object is not modified', () => {
    const defaults = { a: true };
    client({ defaults, defaultsFrom: { a: () => false, b: () => true } });
    expect(defaults).toEqual({ a: true });
  });

  test('inherited keys still never count as defaults', () => {
    const c = client({ defaultsFrom: { other: () => true } });
    expect(c.isEnabledCached('toString')).toBe(false);
    expect(c.isEnabledCached('__proto__')).toBe(false);
  });
});

describe('isEnabledCached (#31)', () => {
  test('returns the configured default when nothing is cached, without a request', () => {
    const c = client({ defaults: { 'new-banner': true } });
    expect(c.isEnabledCached('new-banner')).toBe(true);
    expect(c.isEnabledCached('other')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns the value cached for the same context', async () => {
    const c = client({ defaults: { flag: true } });
    mockEvaluate(false);
    await expect(c.isEnabled('flag', { user_id: 'u1' })).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(c.isEnabledCached('flag', { user_id: 'u1' })).toBe(false);
    // Another context has no entry of its own: the default, not u1's value.
    expect(c.isEnabledCached('flag', { user_id: 'u2' })).toBe(true);
    expect(c.isEnabledCached('flag')).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('applies the configured environment and application to the context key', async () => {
    const c = client({ applicationId: 'app-1', environment: 'staging' });
    mockEvaluate(true);
    await c.isEnabled('flag', { user_id: 'u1' });
    expect(c.isEnabledCached('flag', { user_id: 'u1' })).toBe(true);
    expect(c.isEnabledCached('flag', { user_id: 'u1', environment: 'staging', application_id: 'app-1' })).toBe(true);
    expect(c.isEnabledCached('flag', { user_id: 'u1', environment: 'production' })).toBe(false);
  });

  test('an expired entry is a miss', async () => {
    jest.useFakeTimers();
    try {
      const c = client({ cacheTtl: 1000 });
      mockEvaluate(true);
      await c.isEnabled('flag');
      expect(c.isEnabledCached('flag')).toBe(true);
      jest.advanceTimersByTime(1001);
      expect(c.isEnabledCached('flag')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('an invalidated entry is a miss', async () => {
    const c = client();
    mockEvaluate(true);
    await c.isEnabled('flag');
    c.invalidateCache('flag');
    expect(c.isEnabledCached('flag')).toBe(false);
  });

  test('an invalid key gets its default and a cyclic context is a miss, never a throw', async () => {
    const c = client({ defaults: { flag: true } });
    expect(c.isEnabledCached('a/b')).toBe(false);
    expect(c.isEnabledCached(undefined as unknown as string)).toBe(false);
    const cyclic: any = { user_id: 'u1' };
    cyclic.attributes = { self: cyclic };
    expect(c.isEnabledCached('flag', cyclic)).toBe(true);
  });

  test('overrides never change the answer', async () => {
    const c = client();
    mockEvaluate(true);
    await c.isEnabled('flag');
    c.setVariationOverride('other', 'x');
    expect(c.isEnabledCached('flag')).toBe(true);
  });

  test('is synchronous', () => {
    const c = client();
    const value: unknown = c.isEnabledCached('flag');
    expect(typeof value).toBe('boolean');
  });

  describe('telemetry', () => {
    function telemetryClient(): FlagClient {
      return new FlagClient({ apiKey: 'sdk_test', enableRealtime: false, enableTelemetry: true });
    }

    test('a hit is queued as an evaluation and a miss is not', async () => {
      const c = telemetryClient();
      const track = jest.spyOn((c as any).telemetry, 'trackEvaluation');
      mockEvaluate(true);
      await c.isEnabled('flag');
      track.mockClear();
      expect(c.isEnabledCached('flag')).toBe(true);
      expect(track).toHaveBeenCalledTimes(1);
      expect(track.mock.calls[0][0]).toMatchObject({ flagKey: 'flag', result: true });
      expect(c.isEnabledCached('missing')).toBe(false);
      expect(track).toHaveBeenCalledTimes(1);
      c.close();
    });

    test('never starts a request itself, even when the telemetry batch fills', async () => {
      const c = telemetryClient();
      mockEvaluate(true);
      await c.isEnabled('flag');
      (global.fetch as jest.Mock).mockClear();
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
      for (let i = 0; i < 120; i++) c.isEnabledCached('flag');
      expect(global.fetch).not.toHaveBeenCalled();
      // The full batch is sent from a later turn of the event loop.
      await new Promise((resolve) => setImmediate(resolve));
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/api/telemetry/evaluations');
      c.close();
    });
  });
});

describe('FlagClient.staticFlags (#31)', () => {
  test('serves fixed values and false for any other flag', async () => {
    const c = FlagClient.staticFlags({ 'new-checkout': true, 'beta-banner': false });
    expect(c.isEnabledCached('new-checkout')).toBe(true);
    expect(c.isEnabledCached('beta-banner')).toBe(false);
    expect(c.isEnabledCached('anything-else')).toBe(false);
    await expect(c.isEnabled('new-checkout', { user_id: 'u1' })).resolves.toBe(true);
    await expect(c.evaluate('beta-banner')).resolves.toEqual({
      key: 'beta-banner',
      value: false,
      configuration: undefined,
      variation: undefined,
      reason: 'static',
    });
  });

  test('accepts entries (a Map or an array of pairs)', async () => {
    const fromMap = FlagClient.staticFlags(new Map([['a', true]]));
    const fromPairs = FlagClient.staticFlags([['b', true]]);
    expect(fromMap.isEnabledCached('a')).toBe(true);
    expect(fromPairs.isEnabledCached('b')).toBe(true);
    expect(fromPairs.isEnabledCached('a')).toBe(false);
  });

  test('never touches the network', async () => {
    const c = FlagClient.staticFlags({ flag: true });
    await c.evaluate('flag');
    await c.getConfig('flag');
    await c.getVariation('flag');
    await expect(c.getAllFlags()).resolves.toEqual([]);
    await expect(c.getEnterpriseFlags()).resolves.toEqual([]);
    c.trackError('flag', new Error('boom'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(global.fetch).not.toHaveBeenCalled();
    expect((c as any).realtime).toBeNull();
    expect((c as any).telemetry.flushInterval).toBeNull();
    c.close();
  });

  test('config and variation overrides still apply', async () => {
    const c = FlagClient.staticFlags({ flag: true });
    c.setConfigOverride('flag', { limit: 3 });
    c.setVariationOverride('flag', 'treatment');
    await expect(c.getConfig('flag')).resolves.toEqual({ limit: 3 });
    await expect(c.getVariation('flag')).resolves.toEqual({
      variation: 'treatment',
      enabled: true,
      configuration: { limit: 3 },
    });
  });

  test('an invalid key is still an error', async () => {
    const c = FlagClient.staticFlags({ flag: true });
    const onError = jest.fn();
    (c as any).config.onError = onError;
    await expect(c.evaluate('a/b')).resolves.toMatchObject({ value: false, reason: 'error' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('inherited keys are not flags', () => {
    const c = FlagClient.staticFlags({ flag: true });
    expect(c.isEnabledCached('toString')).toBe(false);
    expect(c.isEnabledCached('__proto__')).toBe(false);
  });
});

describe('plain-HTTP warning for a server key (#44)', () => {
  const MESSAGE = (scheme: string) =>
    `Savvagent Flags: the server key will be sent over ${scheme}; use an https base_url`;

  function warnings(): string[] {
    return warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes('server key'));
  }

  test('warns once for a srv_ key over http to a non-loopback host', () => {
    client({ apiKey: 'srv_secret', baseUrl: 'http://flags.internal:8080' });
    expect(warnings()).toEqual([MESSAGE('http')]);
  });

  test('names the scheme it would use', () => {
    client({ apiKey: 'srv_secret', baseUrl: 'ws://flags.example.com' });
    expect(warnings()).toEqual([MESSAGE('ws')]);
  });

  test.each(['http://localhost:8080', 'http://127.0.0.1:3000/flags', 'http://[::1]:8080'])(
    'does not warn for the loopback base URL %s',
    (baseUrl) => {
      client({ apiKey: 'srv_secret', baseUrl });
      expect(warnings()).toEqual([]);
    }
  );

  test('does not warn over https', () => {
    client({ apiKey: 'srv_secret', baseUrl: 'https://flags.example.com' });
    client({ apiKey: 'srv_secret' });
    expect(warnings()).toEqual([]);
  });

  test('does not warn for an sdk_ key', () => {
    client({ apiKey: 'sdk_public', baseUrl: 'http://flags.example.com' });
    expect(warnings()).toEqual([]);
  });

  test('does not warn for an unparseable base URL', () => {
    client({ apiKey: 'srv_secret', baseUrl: 'not a url' });
    expect(warnings()).toEqual([]);
  });

  test('never includes the key', () => {
    client({ apiKey: 'srv_secret_value', baseUrl: 'http://flags.example.com' });
    expect(warn.mock.calls.flat().join(' ')).not.toContain('srv_secret_value');
  });
});
