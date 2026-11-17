/**
 * Behaviours the browser SDK deliberately lacks, pinned for the cross-SDK
 * behaviour matrix in docs/SDK-DEVELOPER-GUIDE.md. A failure here means the
 * SDK gained one of them: update the matrix along with the test.
 */
import * as sdk from '../src';
import { FlagClient } from '../src/client';
import { RealtimeService } from '../src/realtime';

describe('cross-SDK behaviour matrix: @savvagent/sdk', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('rejects a srv_ server key: the browser SDK takes only public sdk_ keys', () => {
    expect(() => new FlagClient({ apiKey: 'srv_test_key' })).toThrow('Invalid API key');
  });

  test('trackError without a context reports flagEnabled true, with no last-value fallback', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: 'checkout', enabled: false }),
    }) as any;
    const client = new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: false,
      enableTelemetry: false,
      retryAttempts: 1,
    });
    const track = jest.spyOn((client as any).telemetry, 'trackError').mockImplementation(() => {});

    expect(await client.isEnabled('checkout', { user_id: 'a' })).toBe(false);
    client.trackError('checkout', new Error('boom'));

    expect(track).toHaveBeenCalledTimes(1);
    expect((track.mock.calls[0][0] as any).flagEnabled).toBe(true);
    client.close();
  });

  test('has no static test client, cache-only read or env/function defaults', () => {
    expect((FlagClient as any).staticFlags).toBeUndefined();
    expect('isEnabledCached' in FlagClient.prototype).toBe(false);
    expect((sdk as any).defaultFromEnv).toBeUndefined();
  });

  test('a realtime event invalidates the key it names without validating it', () => {
    jest.spyOn(RealtimeService.prototype, 'connect').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const client = new FlagClient({
      apiKey: 'sdk_test_key',
      enableRealtime: true,
      enableTelemetry: false,
    });
    const invalidate = jest.spyOn((client as any).cache, 'invalidate');

    (client as any).realtime.handleMessage({ event: 'flag.updated', data: JSON.stringify({ key: 'a/b' }) });

    expect(sdk.isValidFlagKey('a/b')).toBe(false);
    expect(invalidate).toHaveBeenCalledWith('a/b');
    client.close();
  });
});
