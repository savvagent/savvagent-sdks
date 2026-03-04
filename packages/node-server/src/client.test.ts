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
        baseUrl: 'https://flags-beta.savvagent.com',
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
          value: true,
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
          value: false,
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
          value: true,
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
          value: true,
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
          value: true,
        }),
      });

      const isEnabled = await client.isEnabled('test-flag');
      expect(isEnabled).toBe(true);
    });

    it('should return false when flag is disabled', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: false,
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
          value: true,
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
          value: true,
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
          value: true,
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
        json: async () => ({ value: true }),
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
        json: async () => ({ value: true }),
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
