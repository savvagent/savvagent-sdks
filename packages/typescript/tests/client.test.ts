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
