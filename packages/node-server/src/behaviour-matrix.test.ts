/**
 * Cross-SDK behaviour matrix (docs/SDK-DEVELOPER-GUIDE.md): rows for which
 * node-server had no direct test. A failure here means the behaviour changed:
 * update the matrix along with the test.
 */
import { isValidFlagKey } from '@savvagent/sdk';
import { FlagClient } from './client';
import { RealtimeService } from './realtime';

// No real SSE connection is opened: connect() is stubbed below.
global.EventSource = jest.fn() as any;

describe('cross-SDK behaviour matrix: @savvagent/node-server', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('accepts a srv_ server key as well as an sdk_ client key', () => {
    for (const apiKey of ['srv_test_key', 'sdk_test_key']) {
      const client = new FlagClient({ apiKey, enableRealtime: false, enableTelemetry: false });
      expect(client).toBeInstanceOf(FlagClient);
      client.close();
    }
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

    (client as any).realtime.handleFlagEvent('flag.updated', { data: JSON.stringify({ key: 'a/b' }) });

    expect(isValidFlagKey('a/b')).toBe(false);
    expect(invalidate).toHaveBeenCalledWith('a/b');
    client.close();
  });
});
