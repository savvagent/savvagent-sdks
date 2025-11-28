/**
 * @jest-environment node
 */

import {
  initServerClient,
  getServerClient,
  createServerContext,
  isEnabled,
  evaluate,
  withFlag,
  trackError,
  evaluateForRequest,
  evaluateMultiple,
  isEnabledMultiple,
} from '../src/server';
import { FlagClient } from '@savvagent/sdk';

// Mock Next.js headers and cookies
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

const { cookies, headers } = require('next/headers');

describe('Server Module', () => {
  let mockClient: jest.Mocked<FlagClient>;

  beforeEach(() => {
    // Reset the server client before each test
    jest.resetModules();

    // Create a mock client
    mockClient = {
      isEnabled: jest.fn(),
      evaluate: jest.fn(),
      withFlag: jest.fn(),
      trackError: jest.fn(),
    } as any;

    // Mock cookies and headers
    cookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        const cookieMap: Record<string, any> = {
          user_id: { value: 'user-123' },
          savvagent_anonymous_id: { value: 'anon-456' },
          session_id: { value: 'session-789' },
        };
        return cookieMap[name];
      }),
    });

    headers.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'accept-language') {
          return 'en-US,en;q=0.9';
        }
        return null;
      }),
    });
  });

  describe('initServerClient', () => {
    it('should initialize the server client', () => {
      const config = { apiKey: 'sdk_test_key', enableRealtime: false };

      expect(() => {
        initServerClient(config);
      }).not.toThrow();
    });

    it('should not reinitialize if already initialized', () => {
      const config = { apiKey: 'sdk_test_key', enableRealtime: false };

      initServerClient(config);
      initServerClient(config); // Second call should not create new instance

      expect(() => getServerClient()).not.toThrow();
    });
  });

  describe('getServerClient', () => {
    it('should throw error if client not initialized', () => {
      // Reset module to clear any previous initialization
      jest.resetModules();
      const { getServerClient: getClient } = require('../src/server');

      expect(() => {
        getClient();
      }).toThrow('Server client not initialized');
    });

    it('should return client if initialized', () => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });

      expect(() => {
        const client = getServerClient();
        expect(client).toBeInstanceOf(FlagClient);
      }).not.toThrow();
    });
  });

  describe('createServerContext', () => {
    it('should extract context from cookies and headers', async () => {
      const context = await createServerContext();

      expect(context).toEqual({
        user_id: 'user-123',
        anonymous_id: 'anon-456',
        session_id: 'session-789',
        language: 'en-US',
      });
    });

    it('should merge overrides with extracted context', async () => {
      const overrides = {
        user_id: 'override-user',
        custom_field: 'custom-value',
      };

      const context = await createServerContext(overrides);

      expect(context).toEqual({
        user_id: 'override-user',
        anonymous_id: 'anon-456',
        session_id: 'session-789',
        language: 'en-US',
        custom_field: 'custom-value',
      });
    });

    it('should handle missing cookies gracefully', async () => {
      cookies.mockResolvedValue({
        get: jest.fn(() => undefined),
      });

      const context = await createServerContext();

      expect(context).toEqual({
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: 'en-US',
      });
    });

    it('should handle missing headers gracefully', async () => {
      headers.mockResolvedValue({
        get: jest.fn(() => null),
      });

      const context = await createServerContext();

      expect(context).toEqual({
        user_id: 'user-123',
        anonymous_id: 'anon-456',
        session_id: 'session-789',
        language: undefined,
      });
    });
  });

  describe('isEnabled', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
      // Mock the client's isEnabled method
      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);
    });

    it('should evaluate flag with server context', async () => {
      const result = await isEnabled('test-flag');

      expect(result).toBe(true);
      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'user-123',
          anonymous_id: 'anon-456',
          session_id: 'session-789',
          language: 'en-US',
        })
      );
    });

    it('should merge provided context with server context', async () => {
      const customContext = { custom_field: 'value' };
      const result = await isEnabled('test-flag', customContext);

      expect(result).toBe(true);
      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'user-123',
          custom_field: 'value',
        })
      );
    });
  });

  describe('evaluate', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
      jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'targeting_match',
        metadata: { timestamp: Date.now() },
      });
    });

    it('should evaluate flag and return detailed result', async () => {
      const result = await evaluate('test-flag');

      expect(result).toEqual({
        key: 'test-flag',
        value: true,
        reason: 'targeting_match',
        metadata: expect.objectContaining({ timestamp: expect.any(Number) }),
      });
    });

    it('should use provided context', async () => {
      const customContext = { user_id: 'custom-user' };
      await evaluate('test-flag', customContext);

      expect(FlagClient.prototype.evaluate).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({ user_id: 'custom-user' })
      );
    });
  });

  describe('withFlag', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should execute callback if flag is enabled', async () => {
      const mockCallback = jest.fn().mockReturnValue('callback-result');
      jest.spyOn(FlagClient.prototype, 'withFlag').mockImplementation(
        async (key, cb) => cb()
      );

      const result = await withFlag('test-flag', mockCallback);

      expect(result).toBe('callback-result');
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should return null if flag is disabled', async () => {
      const mockCallback = jest.fn().mockReturnValue('callback-result');
      jest.spyOn(FlagClient.prototype, 'withFlag').mockResolvedValue(null);

      const result = await withFlag('test-flag', mockCallback);

      expect(result).toBeNull();
    });

    it('should handle async callbacks', async () => {
      const mockCallback = jest.fn().mockResolvedValue('async-result');
      jest.spyOn(FlagClient.prototype, 'withFlag').mockImplementation(
        async (key, cb) => cb()
      );

      const result = await withFlag('test-flag', mockCallback);

      expect(result).toBe('async-result');
    });
  });

  describe('trackError', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
      jest.spyOn(FlagClient.prototype, 'trackError').mockImplementation(() => {});
    });

    it('should track error with flag context', async () => {
      const error = new Error('Test error');

      await trackError('test-flag', error);

      expect(FlagClient.prototype.trackError).toHaveBeenCalledWith(
        'test-flag',
        error,
        expect.objectContaining({
          user_id: 'user-123',
        })
      );
    });

    it('should merge provided context', async () => {
      const error = new Error('Test error');
      const customContext = { error_type: 'validation' };

      await trackError('test-flag', error, customContext);

      expect(FlagClient.prototype.trackError).toHaveBeenCalledWith(
        'test-flag',
        error,
        expect.objectContaining({
          user_id: 'user-123',
          error_type: 'validation',
        })
      );
    });
  });

  describe('evaluateForRequest', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);
    });

    it('should extract context from request headers and cookies', async () => {
      const mockRequest = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=req-user; session_id=req-session; savvagent_anonymous_id=req-anon',
          'accept-language': 'fr-FR,fr;q=0.9',
        },
      });

      const result = await evaluateForRequest(mockRequest, 'test-flag');

      expect(result).toBe(true);
      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'req-user',
          session_id: 'req-session',
          anonymous_id: 'req-anon',
          language: 'fr-FR',
        })
      );
    });

    it('should handle requests without cookies', async () => {
      const mockRequest = new Request('https://example.com');

      const result = await evaluateForRequest(mockRequest, 'test-flag');

      expect(result).toBe(true);
      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: undefined,
        })
      );
    });

    it('should merge provided context', async () => {
      const mockRequest = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=req-user',
        },
      });

      const customContext = { custom_field: 'value' };
      await evaluateForRequest(mockRequest, 'test-flag', customContext);

      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'req-user',
          custom_field: 'value',
        })
      );
    });

    it('should parse cookies with equals signs in values', async () => {
      const mockRequest = new Request('https://example.com', {
        headers: {
          cookie: 'user_id=value=with=equals; session_id=normal',
        },
      });

      await evaluateForRequest(mockRequest, 'test-flag');

      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'value=with=equals',
          session_id: 'normal',
        })
      );
    });
  });

  describe('evaluateMultiple', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should evaluate multiple flags in parallel', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate')
        .mockResolvedValueOnce({
          key: 'flag-1',
          value: true,
          reason: 'targeting_match',
          metadata: { timestamp: Date.now() },
        })
        .mockResolvedValueOnce({
          key: 'flag-2',
          value: false,
          reason: 'default',
          metadata: { timestamp: Date.now() },
        })
        .mockResolvedValueOnce({
          key: 'flag-3',
          value: true,
          reason: 'targeting_match',
          metadata: { timestamp: Date.now() },
        });

      const result = await evaluateMultiple(['flag-1', 'flag-2', 'flag-3']);

      expect(result.values).toEqual({
        'flag-1': true,
        'flag-2': false,
        'flag-3': true,
      });
      expect(result.results['flag-1']).toMatchObject({
        key: 'flag-1',
        value: true,
      });
      expect(result.errors['flag-1']).toBeNull();
    });

    it('should handle evaluation errors gracefully', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate')
        .mockResolvedValueOnce({
          key: 'flag-1',
          value: true,
          reason: 'targeting_match',
          metadata: { timestamp: Date.now() },
        })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          key: 'flag-3',
          value: true,
          reason: 'targeting_match',
          metadata: { timestamp: Date.now() },
        });

      const result = await evaluateMultiple(['flag-1', 'flag-2', 'flag-3']);

      expect(result.values).toEqual({
        'flag-1': true,
        'flag-2': false, // Default to false on error
        'flag-3': true,
      });
      expect(result.errors['flag-2']).toBeInstanceOf(Error);
      expect(result.errors['flag-2']?.message).toBe('Network error');
    });

    it('should use default values for failed evaluations', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate')
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'));

      const result = await evaluateMultiple(
        ['flag-1', 'flag-2'],
        undefined,
        { defaultValues: { 'flag-1': true, 'flag-2': true } }
      );

      expect(result.values).toEqual({
        'flag-1': true,
        'flag-2': true,
      });
      expect(result.errors['flag-1']).toBeInstanceOf(Error);
      expect(result.errors['flag-2']).toBeInstanceOf(Error);
    });

    it('should include error reason in result metadata', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate')
        .mockRejectedValueOnce(new Error('Test error'));

      const result = await evaluateMultiple(['flag-1']);

      expect(result.results['flag-1'].reason).toBe('error');
      expect(result.results['flag-1'].metadata).toHaveProperty('timestamp');
    });

    it('should merge provided context with server context', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'targeting_match',
        metadata: { timestamp: Date.now() },
      });

      const customContext = { custom_field: 'value' };
      await evaluateMultiple(['flag-1'], customContext);

      expect(FlagClient.prototype.evaluate).toHaveBeenCalledWith(
        'flag-1',
        expect.objectContaining({
          user_id: 'user-123',
          custom_field: 'value',
        })
      );
    });
  });

  describe('isEnabledMultiple', () => {
    beforeEach(() => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should return only boolean values', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate')
        .mockResolvedValueOnce({
          key: 'flag-1',
          value: true,
          reason: 'targeting_match',
          metadata: { timestamp: Date.now() },
        })
        .mockResolvedValueOnce({
          key: 'flag-2',
          value: false,
          reason: 'default',
          metadata: { timestamp: Date.now() },
        });

      const result = await isEnabledMultiple(['flag-1', 'flag-2']);

      expect(result).toEqual({
        'flag-1': true,
        'flag-2': false,
      });
    });

    it('should use default values when provided', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate')
        .mockRejectedValue(new Error('Network error'));

      const result = await isEnabledMultiple(
        ['flag-1', 'flag-2'],
        undefined,
        { 'flag-1': true, 'flag-2': false }
      );

      expect(result).toEqual({
        'flag-1': true,
        'flag-2': false,
      });
    });

    it('should pass context to evaluateMultiple', async () => {
      jest.spyOn(FlagClient.prototype, 'evaluate').mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'targeting_match',
        metadata: { timestamp: Date.now() },
      });

      const customContext = { user_id: 'custom-user' };
      await isEnabledMultiple(['flag-1'], customContext);

      expect(FlagClient.prototype.evaluate).toHaveBeenCalledWith(
        'flag-1',
        expect.objectContaining({ user_id: 'custom-user' })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle client initialization with invalid API key format', () => {
      // Note: The current SDK doesn't throw on invalid key format,
      // so we test that it initializes but may fail during API calls
      expect(() => {
        initServerClient({ apiKey: 'invalid-key', enableRealtime: false });
      }).not.toThrow();
    });

    it('should propagate evaluation errors', async () => {
      initServerClient({ apiKey: 'sdk_test_key', enableRealtime: false });
      jest.spyOn(FlagClient.prototype, 'isEnabled').mockRejectedValue(
        new Error('Evaluation failed')
      );

      await expect(isEnabled('test-flag')).rejects.toThrow('Evaluation failed');
    });
  });
});
