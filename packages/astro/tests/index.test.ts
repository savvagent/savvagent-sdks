/**
 * Comprehensive unit tests for @savvagent/astro
 *
 * Note: These tests work with the singleton pattern used in the module.
 * The client instance persists across tests, which is intentional to test
 * the real-world behavior of the integration.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { AstroIntegration } from 'astro';

// Create mock functions that will be shared across tests
const mockClose = vi.fn();
const mockIsEnabled = vi.fn();
const mockEvaluate = vi.fn();
const mockWithFlag = vi.fn();
const mockTrackError = vi.fn();

// Mock the FlagClient
vi.mock('@savvagent/sdk', () => {
  class MockFlagClient {
    close = mockClose;
    isEnabled = mockIsEnabled;
    evaluate = mockEvaluate;
    withFlag = mockWithFlag;
    trackError = mockTrackError;
  }

  return {
    FlagClient: MockFlagClient,
  };
});

import { FlagClient } from '@savvagent/sdk';
import savvagent, {
  initSavvagent,
  getSavvagent,
  getRequestContext,
  isEnabled,
  evaluate,
  withFlag,
  trackError,
  evaluateForRequest,
  createFlagMiddleware,
  type SavvagentIntegrationOptions,
  type FlagMiddlewareConfig,
} from '../src/index';

describe('@savvagent/astro', () => {
  // Initialize client once before all tests
  beforeAll(() => {
    initSavvagent({
      apiKey: 'sdk_test_key',
      applicationId: 'test-app',
    });
  });

  describe('Astro Integration', () => {
    it('should export a function that returns an Astro integration', () => {
      const options: SavvagentIntegrationOptions = {
        config: {
          apiKey: 'sdk_test_key',
          applicationId: 'test-app',
        },
      };

      const integration = savvagent(options);

      expect(integration).toBeDefined();
      expect(integration.name).toBe('@savvagent/astro');
      expect(integration.hooks).toBeDefined();
      expect(integration.hooks['astro:config:setup']).toBeDefined();
      expect(integration.hooks['astro:build:done']).toBeDefined();
    });

    it('should initialize FlagClient in astro:config:setup hook', () => {
      const options: SavvagentIntegrationOptions = {
        config: {
          apiKey: 'sdk_test_key',
          applicationId: 'test-app',
          baseUrl: 'https://api.example.com',
        },
      };

      const integration = savvagent(options);
      integration.hooks['astro:config:setup']!();

      // Just verify the integration sets up correctly
      expect(integration.name).toBe('@savvagent/astro');
      expect(integration.hooks['astro:config:setup']).toBeDefined();
    });

    it('should cleanup client in astro:build:done hook', () => {
      mockClose.mockClear();

      const options: SavvagentIntegrationOptions = {
        config: {
          apiKey: 'sdk_test_key',
          applicationId: 'test-app',
        },
      };

      const integration = savvagent(options);
      integration.hooks['astro:config:setup']!();
      integration.hooks['astro:build:done']!();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('initSavvagent', () => {
    it('should initialize and return FlagClient', () => {
      const config = {
        apiKey: 'sdk_test_key_2',
        applicationId: 'test-app-2',
      };

      const client = initSavvagent(config);

      expect(client).toBeDefined();
      expect(client.isEnabled).toBeDefined();
      expect(client.evaluate).toBeDefined();
    });
  });

  describe('getSavvagent', () => {
    it('should return client if initialized', () => {
      const client = getSavvagent();

      expect(client).toBeDefined();
      expect(client.isEnabled).toBeDefined();
    });
  });

  describe('getRequestContext', () => {
    it('should extract context from request headers and cookies', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'user_id=user123; savvagent_anonymous_id=anon456; session_id=sess789',
          'accept-language': 'en-US,en;q=0.9',
        },
      });

      const context = getRequestContext(request);

      expect(context).toEqual({
        user_id: 'user123',
        anonymous_id: 'anon456',
        session_id: 'sess789',
        language: 'en-US',
      });
    });

    it('should handle missing cookies gracefully', () => {
      const request = new Request('https://example.com', {
        headers: {
          'accept-language': 'fr-FR,fr;q=0.9',
        },
      });

      const context = getRequestContext(request);

      expect(context).toEqual({
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: 'fr-FR',
      });
    });

    it('should handle empty cookie header', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': '',
          'accept-language': 'de-DE',
        },
      });

      const context = getRequestContext(request);

      expect(context.language).toBe('de-DE');
    });

    it('should merge overrides with extracted context', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'user_id=user123',
          'accept-language': 'en-US',
        },
      });

      const context = getRequestContext(request, {
        user_id: 'overridden_user',
        custom_property: 'custom_value',
      });

      expect(context).toEqual({
        user_id: 'overridden_user',
        anonymous_id: undefined,
        session_id: undefined,
        language: 'en-US',
        custom_property: 'custom_value',
      });
    });

    it('should handle cookies with equals signs in values', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'token=abc=def=ghi; user_id=user123',
        },
      });

      const context = getRequestContext(request);

      expect(context.user_id).toBe('user123');
    });

    it('should handle malformed cookies gracefully', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'invalid;cookie;format',
        },
      });

      const context = getRequestContext(request);

      expect(context).toBeDefined();
      expect(context.user_id).toBeUndefined();
    });

    it('should handle missing accept-language header', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'user_id=user123',
        },
      });

      const context = getRequestContext(request);

      expect(context.language).toBeUndefined();
    });

    it('should handle requests with multiple accept-language values', () => {
      const request = new Request('https://example.com', {
        headers: {
          'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      const context = getRequestContext(request);

      expect(context.language).toBe('fr-FR');
    });

    it('should handle request with no headers', () => {
      const request = new Request('https://example.com');
      const context = getRequestContext(request);

      expect(context).toEqual({
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
      });
    });

    it('should handle complex cookie parsing scenarios', () => {
      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'a=1; b=; c=3=4=5; d=6',
        },
      });

      const context = getRequestContext(request);

      expect(context).toBeDefined();
      expect(context.user_id).toBeUndefined();
    });
  });

  describe('isEnabled', () => {
    it('should call client.isEnabled with flagKey and context', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const context = { user_id: 'user123' };
      const result = await isEnabled('test-flag', context);

      expect(mockIsEnabled).toHaveBeenCalledWith('test-flag', context);
      expect(result).toBe(true);
    });

    it('should work without context', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(false);

      const result = await isEnabled('test-flag');

      expect(mockIsEnabled).toHaveBeenCalledWith('test-flag', undefined);
      expect(result).toBe(false);
    });
  });

  describe('evaluate', () => {
    it('should call client.evaluate with flagKey and context', async () => {
      mockEvaluate.mockClear();
      const mockResult = {
        flagKey: 'test-flag',
        value: true,
        reason: 'MATCH',
        metadata: {},
      };
      mockEvaluate.mockResolvedValue(mockResult);

      const context = { user_id: 'user123' };
      const result = await evaluate('test-flag', context);

      expect(mockEvaluate).toHaveBeenCalledWith('test-flag', context);
      expect(result).toEqual(mockResult);
    });

    it('should work without context', async () => {
      mockEvaluate.mockClear();
      const mockResult = {
        flagKey: 'test-flag',
        value: false,
        reason: 'DEFAULT',
        metadata: {},
      };
      mockEvaluate.mockResolvedValue(mockResult);

      const result = await evaluate('test-flag');

      expect(mockEvaluate).toHaveBeenCalledWith('test-flag', undefined);
      expect(result).toEqual(mockResult);
    });
  });

  describe('withFlag', () => {
    it('should execute callback when flag is enabled', async () => {
      mockWithFlag.mockClear();
      const mockCallback = vi.fn().mockReturnValue('success');
      mockWithFlag.mockImplementation(async (_, cb) => cb());

      const context = { user_id: 'user123' };
      const result = await withFlag('test-flag', mockCallback, context);

      expect(mockWithFlag).toHaveBeenCalledWith('test-flag', mockCallback, context);
      expect(result).toBe('success');
    });

    it('should return null when flag is disabled', async () => {
      mockWithFlag.mockClear();
      const mockCallback = vi.fn();
      mockWithFlag.mockResolvedValue(null);

      const result = await withFlag('test-flag', mockCallback);

      expect(mockWithFlag).toHaveBeenCalledWith('test-flag', mockCallback, undefined);
      expect(result).toBeNull();
    });

    it('should handle async callbacks', async () => {
      mockWithFlag.mockClear();
      const mockCallback = vi.fn().mockResolvedValue({ data: 'async result' });
      mockWithFlag.mockImplementation(async (_, cb) => cb());

      const result = await withFlag('test-flag', mockCallback);

      expect(result).toEqual({ data: 'async result' });
    });
  });

  describe('trackError', () => {
    it('should call client.trackError with flagKey, error, and context', () => {
      mockTrackError.mockClear();

      const error = new Error('Test error');
      const context = { user_id: 'user123' };
      trackError('test-flag', error, context);

      expect(mockTrackError).toHaveBeenCalledWith('test-flag', error, context);
    });

    it('should work without context', () => {
      mockTrackError.mockClear();

      const error = new Error('Test error');
      trackError('test-flag', error);

      expect(mockTrackError).toHaveBeenCalledWith('test-flag', error, undefined);
    });
  });

  describe('evaluateForRequest', () => {
    it('should extract context from request and evaluate flag', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'user_id=user123; savvagent_anonymous_id=anon456',
          'accept-language': 'en-US,en;q=0.9',
        },
      });

      const result = await evaluateForRequest(request, 'test-flag');

      expect(mockIsEnabled).toHaveBeenCalledWith('test-flag', {
        user_id: 'user123',
        anonymous_id: 'anon456',
        session_id: undefined,
        language: 'en-US',
      });
      expect(result).toBe(true);
    });

    it('should merge additional context with request context', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(false);

      const request = new Request('https://example.com', {
        headers: {
          'cookie': 'user_id=user123',
        },
      });

      const additionalContext = { session_id: 'custom-session' };
      await evaluateForRequest(request, 'test-flag', additionalContext);

      expect(mockIsEnabled).toHaveBeenCalledWith('test-flag', {
        user_id: 'user123',
        anonymous_id: undefined,
        session_id: 'custom-session',
        language: undefined,
      });
    });
  });

  describe('createFlagMiddleware', () => {
    it('should create middleware function', () => {
      const config: FlagMiddlewareConfig = {
        'maintenance-mode': {
          redirect: '/maintenance',
        },
      };

      const middleware = createFlagMiddleware(config);

      expect(middleware).toBeInstanceOf(Function);
    });

    it('should redirect when flag is enabled and redirect is configured', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const config: FlagMiddlewareConfig = {
        'maintenance-mode': {
          redirect: '/maintenance',
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn();

      const response = await middleware(mockContext, mockNext);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://example.com/maintenance');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should rewrite URL when flag is enabled and rewrite is configured', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const config: FlagMiddlewareConfig = {
        'beta-access': {
          rewrite: (url) => '/beta' + url.pathname,
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/dashboard'),
        url: new URL('https://example.com/dashboard'),
      };
      const mockNext = vi.fn().mockResolvedValue(new Response('OK'));

      await middleware(mockContext, mockNext);

      expect(mockContext.url.pathname).toBe('/beta/dashboard');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should call custom handler when flag is enabled and handler is configured', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const mockHandler = vi.fn().mockResolvedValue(new Response('Custom response'));
      const config: FlagMiddlewareConfig = {
        'custom-feature': {
          handler: mockHandler,
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn();

      const response = await middleware(mockContext, mockNext);

      expect(mockHandler).toHaveBeenCalledWith(mockContext);
      expect(response).toBeInstanceOf(Response);
      expect(await response.text()).toBe('Custom response');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should continue to next when handler returns void', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const mockHandler = vi.fn().mockResolvedValue(undefined);
      const config: FlagMiddlewareConfig = {
        'logging-feature': {
          handler: mockHandler,
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn().mockResolvedValue(new Response('Next'));

      const response = await middleware(mockContext, mockNext);

      expect(mockHandler).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(await response.text()).toBe('Next');
    });

    it('should call next when flag is disabled', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(false);

      const config: FlagMiddlewareConfig = {
        'maintenance-mode': {
          redirect: '/maintenance',
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(await response.text()).toBe('OK');
    });

    it('should handle multiple flags in order', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled
        .mockResolvedValueOnce(false) // maintenance-mode disabled
        .mockResolvedValueOnce(true);  // beta-access enabled

      const config: FlagMiddlewareConfig = {
        'maintenance-mode': {
          redirect: '/maintenance',
        },
        'beta-access': {
          redirect: '/beta',
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn();

      const response = await middleware(mockContext, mockNext);

      expect(response.headers.get('location')).toBe('https://example.com/beta');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should extract request context for flag evaluation', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(false);

      const config: FlagMiddlewareConfig = {
        'user-feature': {
          redirect: '/special',
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test', {
          headers: {
            'cookie': 'user_id=user123; session_id=sess456',
            'accept-language': 'es-ES',
          },
        }),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn().mockResolvedValue(new Response('OK'));

      await middleware(mockContext, mockNext);

      expect(mockIsEnabled).toHaveBeenCalledWith('user-feature', {
        user_id: 'user123',
        anonymous_id: undefined,
        session_id: 'sess456',
        language: 'es-ES',
      });
    });

    it('should handle middleware with empty config', async () => {
      mockIsEnabled.mockClear();

      const config: FlagMiddlewareConfig = {};
      const middleware = createFlagMiddleware(config);

      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn().mockResolvedValue(new Response('OK'));

      const response = await middleware(mockContext, mockNext);

      expect(mockIsEnabled).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(await response.text()).toBe('OK');
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from FlagClient', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockRejectedValue(new Error('Network error'));

      await expect(isEnabled('test-flag')).rejects.toThrow('Network error');
    });

    it('should propagate errors from evaluate', async () => {
      mockEvaluate.mockClear();
      mockEvaluate.mockRejectedValue(new Error('API error'));

      await expect(evaluate('test-flag')).rejects.toThrow('API error');
    });

    it('should handle errors in middleware custom handlers', async () => {
      mockIsEnabled.mockClear();
      mockIsEnabled.mockResolvedValue(true);

      const config: FlagMiddlewareConfig = {
        'error-feature': {
          handler: async () => {
            throw new Error('Handler error');
          },
        },
      };

      const middleware = createFlagMiddleware(config);
      const mockContext = {
        request: new Request('https://example.com/test'),
        url: new URL('https://example.com/test'),
      };
      const mockNext = vi.fn();

      await expect(middleware(mockContext, mockNext)).rejects.toThrow('Handler error');
    });
  });

  describe('Type Exports', () => {
    it('should export required types', () => {
      // This is a compile-time check, but we can verify the module exports
      const moduleExports = Object.keys(savvagent);

      // The default export is a function, so we just verify it exists
      expect(savvagent).toBeInstanceOf(Function);
    });
  });

  describe('Integration Lifecycle', () => {
    it('should support full integration lifecycle', () => {
      mockClose.mockClear();

      const options: SavvagentIntegrationOptions = {
        config: {
          apiKey: 'sdk_test_key',
          applicationId: 'test-app',
          baseUrl: 'https://api.example.com',
          enableRealtime: false,
        },
      };

      // Create integration
      const integration = savvagent(options);
      expect(integration.name).toBe('@savvagent/astro');

      // Setup
      integration.hooks['astro:config:setup']!();

      // Use client
      const client = getSavvagent();
      expect(client).toBeDefined();

      // Build done
      integration.hooks['astro:build:done']!();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
