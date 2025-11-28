/**
 * Tests for @savvagent/sveltekit server-side functionality
 *
 * This test suite verifies:
 * - Server client initialization and singleton pattern
 * - Request context extraction from SvelteKit events
 * - Server-side flag evaluation functions
 * - Error handling and edge cases
 * - Integration with FlagClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Create a factory for mock client instances
let mockClientInstance: any;

// Create a mock class that can be used with 'new'
class MockFlagClient {
  isEnabled = vi.fn();
  evaluate = vi.fn();
  withFlag = vi.fn();
  trackError = vi.fn();
  getUserId = vi.fn();
  setUserId = vi.fn();

  constructor(config: any) {
    // Store the instance so tests can access it
    mockClientInstance = this;
  }
}

// Mock the FlagClient before importing server module
vi.mock('@savvagent/sdk', () => {
  return {
    FlagClient: vi.fn(MockFlagClient),
  };
});

describe('@savvagent/sveltekit/server - Server-side functionality', () => {
  // Reset modules between tests to ensure clean state
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initSvelteKitServer', () => {
    it('should initialize the server client with config', async () => {
      const { initSvelteKitServer } = await import('../src/server');
      const { FlagClient } = await import('@savvagent/sdk');

      const config = {
        apiKey: 'test-api-key',
        applicationId: 'test-app-id',
      };

      const client = initSvelteKitServer(config);

      expect(client).toBeDefined();
      expect(FlagClient).toHaveBeenCalledWith(config);
      expect(FlagClient).toHaveBeenCalledTimes(1);
    });

    it('should return the same instance on subsequent calls (singleton)', async () => {
      const { initSvelteKitServer } = await import('../src/server');

      const config = {
        apiKey: 'test-api-key',
        applicationId: 'test-app-id',
      };

      const client1 = initSvelteKitServer(config);
      const client2 = initSvelteKitServer(config);

      expect(client1).toBe(client2);
    });

    it('should accept all valid FlagClientConfig properties', async () => {
      const { initSvelteKitServer } = await import('../src/server');
      const { FlagClient } = await import('@savvagent/sdk');

      const config = {
        apiKey: 'test-api-key',
        applicationId: 'test-app-id',
        baseUrl: 'https://custom.savvagent.com',
        pollingInterval: 60000,
      };

      initSvelteKitServer(config);

      expect(FlagClient).toHaveBeenCalledWith(config);
    });
  });

  describe('getServerClient', () => {
    it('should return the initialized client', async () => {
      const { initSvelteKitServer, getServerClient } = await import('../src/server');

      const config = {
        apiKey: 'test-api-key',
        applicationId: 'test-app-id',
      };

      const initClient = initSvelteKitServer(config);
      const retrievedClient = getServerClient();

      expect(retrievedClient).toBe(initClient);
    });

    it('should throw error if client not initialized', async () => {
      // Import fresh module without initialization
      const { getServerClient } = await import('../src/server');

      expect(() => getServerClient()).toThrow(
        'SvelteKit server client not initialized. Call initSvelteKitServer() first.'
      );
    });
  });

  describe('getEventContext', () => {
    it('should extract user_id from cookies', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'user_id') return 'user-123';
            return undefined;
          }),
        },
        request: {
          headers: new Map() as any,
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.user_id).toBe('user-123');
      expect(mockEvent.cookies.get).toHaveBeenCalledWith('user_id');
    });

    it('should extract anonymous_id from cookies', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'savvagent_anonymous_id') return 'anon-456';
            return undefined;
          }),
        },
        request: {
          headers: new Map() as any,
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.anonymous_id).toBe('anon-456');
      expect(mockEvent.cookies.get).toHaveBeenCalledWith('savvagent_anonymous_id');
    });

    it('should extract session_id from cookies', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'session_id') return 'session-789';
            return undefined;
          }),
        },
        request: {
          headers: new Map() as any,
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.session_id).toBe('session-789');
      expect(mockEvent.cookies.get).toHaveBeenCalledWith('session_id');
    });

    it('should extract language from accept-language header', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => undefined),
        },
        request: {
          headers: {
            get: vi.fn((key: string) => {
              if (key === 'accept-language') return 'en-US,en;q=0.9,es;q=0.8';
              return null;
            }),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.language).toBe('en-US');
      expect(mockEvent.request.headers.get).toHaveBeenCalledWith('accept-language');
    });

    it('should handle missing accept-language header', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => undefined),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.language).toBeUndefined();
    });

    it('should merge overrides with extracted context', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'user_id') return 'user-123';
            return undefined;
          }),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const overrides = {
        environment: 'production',
        organization_id: 'org-456',
      };

      const context = getEventContext(mockEvent, overrides);

      expect(context.user_id).toBe('user-123');
      expect(context.environment).toBe('production');
      expect(context.organization_id).toBe('org-456');
    });

    it('should allow overrides to replace extracted values', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'user_id') return 'user-123';
            return undefined;
          }),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const overrides = {
        user_id: 'override-user',
      };

      const context = getEventContext(mockEvent, overrides);

      expect(context.user_id).toBe('override-user');
    });

    it('should handle all cookies being undefined', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => undefined),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.user_id).toBeUndefined();
      expect(context.anonymous_id).toBeUndefined();
      expect(context.session_id).toBeUndefined();
      expect(context.language).toBeUndefined();
    });
  });

  describe('isEnabled', () => {
    it('should call client.isEnabled with flag key', async () => {
      const { initSvelteKitServer, isEnabled } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      mockClientInstance.isEnabled.mockResolvedValue(true);

      const result = await isEnabled('test-flag');

      expect(result).toBe(true);
      expect(mockClientInstance.isEnabled).toHaveBeenCalledWith('test-flag', undefined);
    });

    it('should pass context to client.isEnabled', async () => {
      const { initSvelteKitServer, isEnabled } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      mockClientInstance.isEnabled.mockResolvedValue(false);

      const context = { user_id: 'user-123', environment: 'production' };
      const result = await isEnabled('test-flag', context);

      expect(result).toBe(false);
      expect(mockClientInstance.isEnabled).toHaveBeenCalledWith('test-flag', context);
    });

    it('should throw if client not initialized', async () => {
      // Import fresh module
      const { isEnabled } = await import('../src/server');

      await expect(isEnabled('test-flag')).rejects.toThrow(
        'SvelteKit server client not initialized'
      );
    });
  });

  describe('evaluate', () => {
    it('should call client.evaluate with flag key', async () => {
      const { initSvelteKitServer, evaluate } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const mockResult = {
        value: true,
        flagKey: 'test-flag',
        reason: 'default',
        timestamp: new Date().toISOString(),
      };
      mockClientInstance.evaluate.mockResolvedValue(mockResult);

      const result = await evaluate('test-flag');

      expect(result).toEqual(mockResult);
      expect(mockClientInstance.evaluate).toHaveBeenCalledWith('test-flag', undefined);
    });

    it('should pass context to client.evaluate', async () => {
      const { initSvelteKitServer, evaluate } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const mockResult = {
        value: false,
        flagKey: 'test-flag',
        reason: 'targeting',
        timestamp: new Date().toISOString(),
      };
      mockClientInstance.evaluate.mockResolvedValue(mockResult);

      const context = { user_id: 'user-456' };
      const result = await evaluate('test-flag', context);

      expect(result).toEqual(mockResult);
      expect(mockClientInstance.evaluate).toHaveBeenCalledWith('test-flag', context);
    });
  });

  describe('withFlag', () => {
    it('should call client.withFlag and execute callback if enabled', async () => {
      const { initSvelteKitServer, withFlag } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const callbackResult = { data: 'test-data' };
      mockClientInstance.withFlag.mockResolvedValue(callbackResult);

      const callback = vi.fn(() => callbackResult);
      const result = await withFlag('test-flag', callback);

      expect(result).toEqual(callbackResult);
      expect(mockClientInstance.withFlag).toHaveBeenCalledWith('test-flag', callback, undefined);
    });

    it('should return null if flag is disabled', async () => {
      const { initSvelteKitServer, withFlag } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      mockClientInstance.withFlag.mockResolvedValue(null);

      const callback = vi.fn();
      const result = await withFlag('test-flag', callback);

      expect(result).toBeNull();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should pass context to client.withFlag', async () => {
      const { initSvelteKitServer, withFlag } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const callbackResult = 'executed';
      mockClientInstance.withFlag.mockResolvedValue(callbackResult);

      const callback = vi.fn(() => callbackResult);
      const context = { user_id: 'user-789' };
      await withFlag('test-flag', callback, context);

      expect(mockClientInstance.withFlag).toHaveBeenCalledWith('test-flag', callback, context);
    });

    it('should handle async callbacks', async () => {
      const { initSvelteKitServer, withFlag } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const asyncData = 'async-data';
      mockClientInstance.withFlag.mockResolvedValue(asyncData);

      const asyncCallback = vi.fn(async () => asyncData);
      const result = await withFlag('test-flag', asyncCallback);

      expect(result).toBe(asyncData);
    });
  });

  describe('trackError', () => {
    it('should call client.trackError with flag key and error', async () => {
      const { initSvelteKitServer, trackError } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const error = new Error('Test error');

      trackError('test-flag', error);

      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, undefined);
    });

    it('should pass context to client.trackError', async () => {
      const { initSvelteKitServer, trackError } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      const error = new Error('Test error');
      const context = { user_id: 'error-user', environment: 'staging' };

      trackError('test-flag', error, context);

      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, context);
    });

    it('should handle different error types', async () => {
      const { initSvelteKitServer, trackError } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      // TypeError
      const typeError = new TypeError('Type error');
      trackError('test-flag', typeError);
      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', typeError, undefined);

      // Custom error
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const customError = new CustomError('Custom error');
      trackError('test-flag', customError);
      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', customError, undefined);
    });
  });

  describe('evaluateForEvent', () => {
    it('should extract context from event and evaluate flag', async () => {
      const { initSvelteKitServer, evaluateForEvent } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      mockClientInstance.isEnabled.mockResolvedValue(true);

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'user_id') return 'event-user';
            return undefined;
          }),
        },
        request: {
          headers: {
            get: vi.fn((key: string) => {
              if (key === 'accept-language') return 'fr-FR';
              return null;
            }),
          },
        },
      } as any;

      const result = await evaluateForEvent(mockEvent, 'test-flag');

      expect(result).toBe(true);
      expect(mockClientInstance.isEnabled).toHaveBeenCalledWith('test-flag', {
        user_id: 'event-user',
        anonymous_id: undefined,
        session_id: undefined,
        language: 'fr-FR',
      });
    });

    it('should merge additional context with event context', async () => {
      const { initSvelteKitServer, evaluateForEvent } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      mockClientInstance.isEnabled.mockResolvedValue(false);

      const mockEvent = {
        cookies: {
          get: vi.fn((key: string) => {
            if (key === 'user_id') return 'event-user';
            return undefined;
          }),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const additionalContext = {
        environment: 'development',
        organization_id: 'org-123',
      };

      const result = await evaluateForEvent(mockEvent, 'test-flag', additionalContext);

      expect(result).toBe(false);
      expect(mockClientInstance.isEnabled).toHaveBeenCalledWith('test-flag', {
        user_id: 'event-user',
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
        environment: 'development',
        organization_id: 'org-123',
      });
    });

    it('should handle events with minimal data', async () => {
      const { initSvelteKitServer, evaluateForEvent } = await import('../src/server');

      const config = { apiKey: 'test-key', applicationId: 'test-app' };
      initSvelteKitServer(config);

      mockClientInstance.isEnabled.mockResolvedValue(true);

      const mockEvent = {
        cookies: {
          get: vi.fn(() => undefined),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const result = await evaluateForEvent(mockEvent, 'test-flag');

      expect(result).toBe(true);
      expect(mockClientInstance.isEnabled).toHaveBeenCalledWith('test-flag', {
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null cookie values gracefully', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => null),
        },
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context).toEqual({
        user_id: null,
        anonymous_id: null,
        session_id: null,
        language: undefined,
      });
    });

    it('should handle empty string cookie values', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => ''),
        },
        request: {
          headers: {
            get: vi.fn(() => ''),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.user_id).toBe('');
      expect(context.language).toBeUndefined();
    });

    it('should handle accept-language with single locale', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => undefined),
        },
        request: {
          headers: {
            get: vi.fn((key: string) => {
              if (key === 'accept-language') return 'en';
              return null;
            }),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.language).toBe('en');
    });

    it('should prioritize first language in accept-language header', async () => {
      const { getEventContext } = await import('../src/server');

      const mockEvent = {
        cookies: {
          get: vi.fn(() => undefined),
        },
        request: {
          headers: {
            get: vi.fn((key: string) => {
              if (key === 'accept-language') return 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7';
              return null;
            }),
          },
        },
      } as any;

      const context = getEventContext(mockEvent);

      expect(context.language).toBe('de-DE');
    });
  });

  describe('Type safety', () => {
    it('should accept valid RequestEvent types', async () => {
      const { getEventContext } = await import('../src/server');

      // Type test - should compile with Pick<RequestEvent, 'cookies' | 'request'>
      const event: Pick<RequestEvent, 'cookies' | 'request'> = {
        cookies: {
          get: vi.fn(() => 'test'),
        } as any,
        request: {
          headers: {
            get: vi.fn(() => null),
          },
        } as any,
      };

      const context = getEventContext(event);
      expect(context).toBeDefined();
    });
  });
});
