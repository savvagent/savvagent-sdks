/**
 * Comprehensive unit tests for @savvagent/remix server-side utilities
 *
 * Tests cover:
 * - Client initialization and lifecycle
 * - Request context extraction
 * - Flag evaluation functions
 * - Error handling and edge cases
 * - Loader/action integration patterns
 */

import { FlagClient, FlagClientConfig, FlagContext } from '@savvagent/sdk';

// Mock the FlagClient before importing server utilities
jest.mock('@savvagent/sdk');

// Import after mocking
import * as server from '../src/server';

describe('@savvagent/remix - Server Utilities', () => {
  let mockClient: any;
  const MockedFlagClient = FlagClient as jest.MockedClass<typeof FlagClient>;

  beforeEach(() => {
    // Reset mock implementation
    mockClient = {
      isEnabled: jest.fn(),
      evaluate: jest.fn(),
      withFlag: jest.fn(),
      trackError: jest.fn(),
    };

    MockedFlagClient.mockImplementation(() => mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset the singleton for each test
    // serverClient is exported for testing purposes
    (server as any).serverClient = null;
  });

  describe('initRemixClient', () => {
    it('should initialize the client with valid configuration', () => {
      const config: FlagClientConfig = {
        apiKey: 'sdk_test_key_123',
        applicationId: 'app_123',
        baseUrl: 'https://flags-api.savvagent.com',
      };

      server.initRemixClient(config);

      expect(MockedFlagClient).toHaveBeenCalledWith(config);
      expect(MockedFlagClient).toHaveBeenCalledTimes(1);
    });

    it('should not reinitialize if already initialized', () => {
      const config: FlagClientConfig = {
        apiKey: 'sdk_test_key_123',
        applicationId: 'app_123',
      };

      server.initRemixClient(config);
      server.initRemixClient(config);

      expect(MockedFlagClient).toHaveBeenCalledTimes(1);
    });

    it('should accept minimal configuration', () => {
      const config: FlagClientConfig = {
        apiKey: 'sdk_test_key_123',
      };

      server.initRemixClient(config);

      expect(MockedFlagClient).toHaveBeenCalledWith(config);
    });

    it('should accept full configuration with all options', () => {
      const config: FlagClientConfig = {
        apiKey: 'sdk_test_key_123',
        applicationId: 'app_123',
        baseUrl: 'https://custom.api.com',
        enableRealtime: false,
        cacheTtl: 30000,
        enableTelemetry: false,
        defaults: { 'feature-1': true },
        onError: jest.fn(),
        defaultLanguage: 'en-US',
        disableLanguageDetection: true,
      };

      server.initRemixClient(config);

      expect(MockedFlagClient).toHaveBeenCalledWith(config);
    });
  });

  describe('getRemixClient', () => {
    it('should return the initialized client', () => {
      const config: FlagClientConfig = { apiKey: 'sdk_test_key_123' };

      server.initRemixClient(config);
      const client = server.getRemixClient();

      expect(client).toBe(mockClient);
    });

    it('should throw error if client is not initialized', () => {
      expect(() => server.getRemixClient()).toThrow(
        'Remix client not initialized. Call initRemixClient() first.'
      );
    });
  });

  describe('getRequestContext', () => {
    it('should extract user_id from cookies', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.user_id).toBe('user123');
    });

    it('should extract anonymous_id from cookies', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'savvagent_anonymous_id=anon_456',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.anonymous_id).toBe('anon_456');
    });

    it('should extract session_id from cookies', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'session_id=sess_789',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.session_id).toBe('sess_789');
    });

    it('should extract multiple cookies', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123; session_id=sess_789; other=value',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.user_id).toBe('user123');
      expect(context.session_id).toBe('sess_789');
    });

    it('should extract language from accept-language header', () => {
      const request = new Request('https://example.com', {
        headers: {
          'accept-language': 'en-US,en;q=0.9',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.language).toBe('en-US');
    });

    it('should handle missing cookies gracefully', () => {
      const request = new Request('https://example.com');

      const context = server.getRequestContext(request);

      expect(context.user_id).toBeUndefined();
      expect(context.anonymous_id).toBeUndefined();
      expect(context.session_id).toBeUndefined();
    });

    it('should handle missing accept-language header', () => {
      const request = new Request('https://example.com');

      const context = server.getRequestContext(request);

      expect(context.language).toBeUndefined();
    });

    it('should merge overrides into extracted context', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123',
          'accept-language': 'en-US',
        },
      });

      const overrides: FlagContext = {
        attributes: { plan: 'pro', tier: 'premium' },
        custom_field: 'value',
      };

      const context = server.getRequestContext(request, overrides);

      expect(context.user_id).toBe('user123');
      expect(context.language).toBe('en-US');
      expect(context.attributes).toEqual({ plan: 'pro', tier: 'premium' });
      expect(context.custom_field).toBe('value');
    });

    it('should allow overrides to replace extracted values', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123',
        },
      });

      const overrides: FlagContext = {
        user_id: 'override_user',
      };

      const context = server.getRequestContext(request, overrides);

      expect(context.user_id).toBe('override_user');
    });

    it('should handle cookies with equals signs in values', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'token=abc=def=ghi; user_id=user123',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.user_id).toBe('user123');
    });

    it('should handle empty cookie header', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: '',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.user_id).toBeUndefined();
    });

    it('should extract only the first language from accept-language', () => {
      const request = new Request('https://example.com', {
        headers: {
          'accept-language': 'fr-FR,en-US;q=0.9,en;q=0.8',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.language).toBe('fr-FR');
    });
  });

  describe('isEnabled', () => {
    beforeEach(() => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });
    });

    it('should delegate to client.isEnabled', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      const result = await server.isEnabled('feature-flag');

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', undefined);
      expect(result).toBe(true);
    });

    it('should pass context to client.isEnabled', async () => {
      mockClient.isEnabled.mockResolvedValue(false);

      const context: FlagContext = { user_id: 'user123' };
      const result = await server.isEnabled('feature-flag', context);

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', context);
      expect(result).toBe(false);
    });

    it('should throw error if client is not initialized', async () => {
      // Reset client
      (server as any).serverClient = null;

      await expect(server.isEnabled('feature-flag')).rejects.toThrow(
        'Remix client not initialized. Call initRemixClient() first.'
      );
    });

    it('should handle client errors', async () => {
      mockClient.isEnabled.mockRejectedValue(new Error('Network error'));

      await expect(server.isEnabled('feature-flag')).rejects.toThrow('Network error');
    });

    it('should work with multiple flag evaluations', async () => {
      mockClient.isEnabled
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      expect(await server.isEnabled('flag-1')).toBe(true);
      expect(await server.isEnabled('flag-2')).toBe(false);
      expect(await server.isEnabled('flag-3')).toBe(true);
      expect(mockClient.isEnabled).toHaveBeenCalledTimes(3);
    });
  });

  describe('evaluate', () => {
    beforeEach(() => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });
    });

    it('should delegate to client.evaluate', async () => {
      const mockResult = {
        value: true,
        flagKey: 'feature-flag',
        reason: 'targeting_match',
      };
      mockClient.evaluate.mockResolvedValue(mockResult);

      const result = await server.evaluate('feature-flag');

      expect(mockClient.evaluate).toHaveBeenCalledWith('feature-flag', undefined);
      expect(result).toEqual(mockResult);
    });

    it('should pass context to client.evaluate', async () => {
      const mockResult = {
        value: false,
        flagKey: 'feature-flag',
        reason: 'default',
      };
      mockClient.evaluate.mockResolvedValue(mockResult);

      const context: FlagContext = { user_id: 'user123', attributes: { plan: 'pro' } };
      const result = await server.evaluate('feature-flag', context);

      expect(mockClient.evaluate).toHaveBeenCalledWith('feature-flag', context);
      expect(result).toEqual(mockResult);
    });

    it('should return detailed evaluation result', async () => {
      const mockResult = {
        value: true,
        flagKey: 'beta-features',
        reason: 'user_targeting',
        context: { user_id: 'user123' },
      };
      mockClient.evaluate.mockResolvedValue(mockResult);

      const result = await server.evaluate('beta-features', { user_id: 'user123' });

      expect(result.value).toBe(true);
      expect(result.flagKey).toBe('beta-features');
      expect(result.reason).toBe('user_targeting');
      expect(result.context).toEqual({ user_id: 'user123' });
    });

    it('should throw error if client is not initialized', async () => {
      (server as any).serverClient = null;

      await expect(server.evaluate('feature-flag')).rejects.toThrow(
        'Remix client not initialized. Call initRemixClient() first.'
      );
    });

    it('should handle client errors', async () => {
      mockClient.evaluate.mockRejectedValue(new Error('API error'));

      await expect(server.evaluate('feature-flag')).rejects.toThrow('API error');
    });
  });

  describe('withFlag', () => {
    beforeEach(() => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });
    });

    it('should execute callback when flag is enabled', async () => {
      const callback = jest.fn().mockResolvedValue('result');
      mockClient.withFlag.mockResolvedValue('result');

      const result = await server.withFlag('feature-flag', callback);

      expect(mockClient.withFlag).toHaveBeenCalledWith(
        'feature-flag',
        callback,
        undefined
      );
      expect(result).toBe('result');
    });

    it('should not execute callback when flag is disabled', async () => {
      const callback = jest.fn().mockResolvedValue('result');
      mockClient.withFlag.mockResolvedValue(null);

      const result = await server.withFlag('feature-flag', callback);

      expect(mockClient.withFlag).toHaveBeenCalledWith(
        'feature-flag',
        callback,
        undefined
      );
      expect(result).toBeNull();
    });

    it('should pass context to client.withFlag', async () => {
      const callback = jest.fn().mockResolvedValue('result');
      mockClient.withFlag.mockResolvedValue('result');

      const context: FlagContext = { user_id: 'user123' };
      await server.withFlag('feature-flag', callback, context);

      expect(mockClient.withFlag).toHaveBeenCalledWith(
        'feature-flag',
        callback,
        context
      );
    });

    it('should handle synchronous callbacks', async () => {
      const callback = jest.fn().mockReturnValue('sync-result');
      mockClient.withFlag.mockResolvedValue('sync-result');

      const result = await server.withFlag('feature-flag', callback);

      expect(result).toBe('sync-result');
    });

    it('should handle async callbacks', async () => {
      const callback = jest.fn().mockResolvedValue('async-result');
      mockClient.withFlag.mockResolvedValue('async-result');

      const result = await server.withFlag('feature-flag', callback);

      expect(result).toBe('async-result');
    });

    it('should throw error if client is not initialized', async () => {
      (server as any).serverClient = null;

      await expect(
        server.withFlag('feature-flag', () => 'result')
      ).rejects.toThrow(
        'Remix client not initialized. Call initRemixClient() first.'
      );
    });

    it('should handle callback errors', async () => {
      const callback = jest.fn().mockRejectedValue(new Error('Callback error'));
      mockClient.withFlag.mockRejectedValue(new Error('Callback error'));

      await expect(server.withFlag('feature-flag', callback)).rejects.toThrow(
        'Callback error'
      );
    });

    it('should work with complex return types', async () => {
      const complexResult = {
        data: [1, 2, 3],
        meta: { count: 3 },
      };
      const callback = jest.fn().mockResolvedValue(complexResult);
      mockClient.withFlag.mockResolvedValue(complexResult);

      const result = await server.withFlag('feature-flag', callback);

      expect(result).toEqual(complexResult);
    });
  });

  describe('trackError', () => {
    beforeEach(() => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });
    });

    it('should delegate to client.trackError', () => {
      const error = new Error('Test error');

      server.trackError('feature-flag', error);

      expect(mockClient.trackError).toHaveBeenCalledWith(
        'feature-flag',
        error,
        undefined
      );
    });

    it('should pass context to client.trackError', () => {
      const error = new Error('Test error');
      const context: FlagContext = { user_id: 'user123' };

      server.trackError('feature-flag', error, context);

      expect(mockClient.trackError).toHaveBeenCalledWith(
        'feature-flag',
        error,
        context
      );
    });

    it('should throw error if client is not initialized', () => {
      (server as any).serverClient = null;

      expect(() =>
        server.trackError('feature-flag', new Error('Test error'))
      ).toThrow('Remix client not initialized. Call initRemixClient() first.');
    });

    it('should handle different error types', () => {
      const errors = [
        new Error('Standard error'),
        new TypeError('Type error'),
        new RangeError('Range error'),
      ];

      errors.forEach((error) => {
        server.trackError('feature-flag', error);
      });

      expect(mockClient.trackError).toHaveBeenCalledTimes(3);
    });

    it('should not throw when tracking errors', () => {
      const error = new Error('Test error');

      expect(() => server.trackError('feature-flag', error)).not.toThrow();
    });
  });

  describe('evaluateForRequest', () => {
    beforeEach(() => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });
    });

    it('should extract context from request and evaluate flag', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123',
          'accept-language': 'en-US',
        },
      });

      const result = await server.evaluateForRequest(request, 'feature-flag');

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', {
        user_id: 'user123',
        anonymous_id: undefined,
        session_id: undefined,
        language: 'en-US',
      });
      expect(result).toBe(true);
    });

    it('should merge additional context with request context', async () => {
      mockClient.isEnabled.mockResolvedValue(false);

      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123',
        },
      });

      const additionalContext: FlagContext = {
        attributes: { plan: 'pro' },
      };

      await server.evaluateForRequest(request, 'feature-flag', additionalContext);

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', {
        user_id: 'user123',
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
        attributes: { plan: 'pro' },
      });
    });

    it('should work with minimal request headers', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      const request = new Request('https://example.com');

      const result = await server.evaluateForRequest(request, 'feature-flag');

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', {
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
      });
      expect(result).toBe(true);
    });

    it('should throw error if client is not initialized', async () => {
      (server as any).serverClient = null;

      const request = new Request('https://example.com');

      await expect(
        server.evaluateForRequest(request, 'feature-flag')
      ).rejects.toThrow(
        'Remix client not initialized. Call initRemixClient() first.'
      );
    });

    it('should handle multiple cookies and headers', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      const request = new Request('https://example.com', {
        headers: {
          cookie:
            'user_id=user123; savvagent_anonymous_id=anon_456; session_id=sess_789',
          'accept-language': 'fr-FR,en;q=0.9',
        },
      });

      await server.evaluateForRequest(request, 'feature-flag');

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', {
        user_id: 'user123',
        anonymous_id: 'anon_456',
        session_id: 'sess_789',
        language: 'fr-FR',
      });
    });

    it('should allow context overrides to replace request values', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user123',
        },
      });

      const overrides: FlagContext = {
        user_id: 'override_user',
        language: 'es-ES',
      };

      await server.evaluateForRequest(request, 'feature-flag', overrides);

      expect(mockClient.isEnabled).toHaveBeenCalledWith('feature-flag', {
        user_id: 'override_user',
        anonymous_id: undefined,
        session_id: undefined,
        language: 'es-ES',
      });
    });
  });

  describe('Integration Tests - Loader Patterns', () => {
    beforeEach(() => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });
    });

    it('should support typical loader pattern with isEnabled', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      // Simulate a Remix loader
      const loader = async ({ request }: { request: Request }) => {
        const enabled = await server.isEnabled('new-feature', {
          user_id: 'user123',
        });
        return { enabled };
      };

      const request = new Request('https://example.com');
      const result = await loader({ request });

      expect(result).toEqual({ enabled: true });
    });

    it('should support loader pattern with evaluateForRequest', async () => {
      mockClient.isEnabled.mockResolvedValue(true);

      // Simulate a Remix loader with automatic context extraction
      const loader = async ({ request }: { request: Request }) => {
        const showBeta = await server.evaluateForRequest(request, 'beta-ui');
        return { component: showBeta ? 'beta' : 'stable' };
      };

      const request = new Request('https://example.com', {
        headers: { cookie: 'user_id=user123' },
      });
      const result = await loader({ request });

      expect(result).toEqual({ component: 'beta' });
    });

    it('should support loader pattern with evaluate for detailed results', async () => {
      const mockResult = {
        value: true,
        flagKey: 'premium-feature',
        reason: 'targeting_match',
      };
      mockClient.evaluate.mockResolvedValue(mockResult);

      // Simulate a Remix loader returning detailed evaluation
      const loader = async () => {
        const result = await server.evaluate('premium-feature', {
          user_id: 'user123',
          attributes: { plan: 'pro' },
        });
        return {
          enabled: result.value,
          reason: result.reason,
        };
      };

      const result = await loader();

      expect(result).toEqual({
        enabled: true,
        reason: 'targeting_match',
      });
    });

    it('should support action pattern with error tracking', async () => {
      // Simulate a Remix action with error handling
      const action = async () => {
        try {
          throw new Error('Form processing failed');
        } catch (error) {
          server.trackError('new-form-processor', error as Error, {
            user_id: 'user123',
          });
          return { error: 'Failed', status: 500 };
        }
      };

      const result = await action();

      expect(result).toEqual({ error: 'Failed', status: 500 });
      expect(mockClient.trackError).toHaveBeenCalledWith(
        'new-form-processor',
        expect.any(Error),
        { user_id: 'user123' }
      );
    });

    it('should support loader pattern with withFlag for conditional data fetching', async () => {
      const mockData = { items: [1, 2, 3] };
      mockClient.withFlag.mockResolvedValue(mockData);

      // Simulate loader with conditional API call
      const loader = async () => {
        const data = await server.withFlag('use-new-api', async () => {
          return mockData;
        });
        return { data };
      };

      const result = await loader();

      expect(result).toEqual({ data: mockData });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle request with malformed cookies', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'invalid;;;cookie=;=value',
        },
      });

      const context = server.getRequestContext(request);

      // Should not crash, just return undefined values
      expect(context).toBeDefined();
    });

    it('should handle very long cookie values', () => {
      const longValue = 'x'.repeat(10000);
      const request = new Request('https://example.com', {
        headers: {
          cookie: `user_id=${longValue}`,
        },
      });

      const context = server.getRequestContext(request);

      expect(context.user_id).toBe(longValue);
    });

    it('should handle special characters in cookie values', () => {
      const request = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=user%20123; session_id=sess%2F456',
        },
      });

      const context = server.getRequestContext(request);

      expect(context.user_id).toBe('user%20123');
      expect(context.session_id).toBe('sess%2F456');
    });

    it('should handle requests with no headers', () => {
      const request = new Request('https://example.com');

      const context = server.getRequestContext(request);

      expect(context).toEqual({
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
      });
    });

    it('should handle concurrent flag evaluations', async () => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });

      mockClient.isEnabled
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const promises = [
        server.isEnabled('flag-1'),
        server.isEnabled('flag-2'),
        server.isEnabled('flag-3'),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual([true, false, true]);
      expect(mockClient.isEnabled).toHaveBeenCalledTimes(3);
    });

    it('should preserve context type safety', async () => {
      server.initRemixClient({ apiKey: 'sdk_test_key_123' });

      mockClient.isEnabled.mockResolvedValue(true);

      const context: FlagContext = {
        user_id: 'user123',
        attributes: {
          plan: 'pro',
          tier: 'premium',
        },
        custom_field: 'value',
      };

      await server.isEnabled('feature-flag', context);

      expect(mockClient.isEnabled).toHaveBeenCalledWith(
        'feature-flag',
        context
      );
    });
  });
});
