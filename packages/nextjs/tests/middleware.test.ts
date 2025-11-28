/**
 * @jest-environment node
 */

import {
  initMiddlewareClient,
  getMiddlewareClient,
  getRequestContext,
  isEnabledInMiddleware,
  createMiddleware,
  redirectIfEnabled,
  rewriteIfEnabled,
} from '../src/middleware';
import { FlagClient } from '@savvagent/sdk';
import { NextRequest, NextResponse } from 'next/server';

// Mock Next.js server module
jest.mock('next/server', () => {
  const actualModule = jest.requireActual('next/server');
  return {
    ...actualModule,
    NextResponse: {
      next: jest.fn(() => ({ type: 'next' })),
      redirect: jest.fn((url: URL) => ({ type: 'redirect', url })),
      rewrite: jest.fn((url: URL) => ({ type: 'rewrite', url })),
    },
  };
});

describe('Middleware Module', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('initMiddlewareClient', () => {
    it('should initialize the middleware client', () => {
      const config = { apiKey: 'sdk_test_key', enableRealtime: false };

      expect(() => {
        initMiddlewareClient(config);
      }).not.toThrow();
    });

    it('should not reinitialize if already initialized', () => {
      const config = { apiKey: 'sdk_test_key', enableRealtime: false };

      initMiddlewareClient(config);
      initMiddlewareClient(config); // Second call should not create new instance

      expect(() => getMiddlewareClient()).not.toThrow();
    });
  });

  describe('getMiddlewareClient', () => {
    it('should throw error if client not initialized', () => {
      jest.resetModules();
      const { getMiddlewareClient: getClient } = require('../src/middleware');

      expect(() => {
        getClient();
      }).toThrow('Middleware client not initialized');
    });

    it('should return client if initialized', () => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });

      expect(() => {
        const client = getMiddlewareClient();
        expect(client).toBeInstanceOf(FlagClient);
      }).not.toThrow();
    });
  });

  describe('getRequestContext', () => {
    it('should extract context from request cookies and headers', () => {
      const mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            const cookies: Record<string, any> = {
              user_id: { value: 'user-123' },
              savvagent_anonymous_id: { value: 'anon-456' },
              session_id: { value: 'session-789' },
            };
            return cookies[name];
          }),
        },
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'accept-language') {
              return 'en-US,en;q=0.9';
            }
            return null;
          }),
        },
      } as unknown as NextRequest;

      const context = getRequestContext(mockRequest);

      expect(context).toEqual({
        user_id: 'user-123',
        anonymous_id: 'anon-456',
        session_id: 'session-789',
        language: 'en-US',
      });
    });

    it('should merge overrides with extracted context', () => {
      const mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            if (name === 'user_id') {
              return { value: 'user-123' };
            }
            return undefined;
          }),
        },
        headers: {
          get: jest.fn(() => null),
        },
      } as unknown as NextRequest;

      const overrides = {
        user_id: 'override-user',
        custom_field: 'custom-value',
      };

      const context = getRequestContext(mockRequest, overrides);

      expect(context).toEqual({
        user_id: 'override-user',
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
        custom_field: 'custom-value',
      });
    });

    it('should handle missing cookies gracefully', () => {
      const mockRequest = {
        cookies: {
          get: jest.fn(() => undefined),
        },
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'accept-language') {
              return 'fr-FR,fr;q=0.9';
            }
            return null;
          }),
        },
      } as unknown as NextRequest;

      const context = getRequestContext(mockRequest);

      expect(context).toEqual({
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: 'fr-FR',
      });
    });

    it('should handle missing headers gracefully', () => {
      const mockRequest = {
        cookies: {
          get: jest.fn(() => undefined),
        },
        headers: {
          get: jest.fn(() => null),
        },
      } as unknown as NextRequest;

      const context = getRequestContext(mockRequest);

      expect(context).toEqual({
        user_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
      });
    });

    it('should extract first language from accept-language header', () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'accept-language') {
              return 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7';
            }
            return null;
          }),
        },
      } as unknown as NextRequest;

      const context = getRequestContext(mockRequest);

      expect(context.language).toBe('de-DE');
    });
  });

  describe('isEnabledInMiddleware', () => {
    beforeEach(() => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should evaluate flag with request context', async () => {
      const mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            if (name === 'user_id') {
              return { value: 'user-123' };
            }
            return undefined;
          }),
        },
        headers: {
          get: jest.fn(() => null),
        },
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const result = await isEnabledInMiddleware(mockRequest, 'test-flag');

      expect(result).toBe(true);
      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'user-123',
        })
      );
    });

    it('should merge provided context with request context', async () => {
      const mockRequest = {
        cookies: {
          get: jest.fn(() => undefined),
        },
        headers: {
          get: jest.fn(() => null),
        },
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const customContext = { user_id: 'custom-user', region: 'us-west' };
      await isEnabledInMiddleware(mockRequest, 'test-flag', customContext);

      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'custom-user',
          region: 'us-west',
        })
      );
    });

    it('should handle evaluation errors', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        isEnabledInMiddleware(mockRequest, 'test-flag')
      ).rejects.toThrow('Network error');
    });
  });

  describe('createMiddleware', () => {
    beforeEach(() => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should create middleware that returns NextResponse.next() by default', async () => {
      const middleware = createMiddleware();
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      const response = await middleware(mockRequest);

      expect(NextResponse.next).toHaveBeenCalled();
      expect(response).toEqual({ type: 'next' });
    });

    it('should execute custom onRequest handler', async () => {
      const onRequest = jest.fn().mockResolvedValue(undefined);
      const middleware = createMiddleware({ onRequest });

      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      await middleware(mockRequest);

      expect(onRequest).toHaveBeenCalledWith(
        mockRequest,
        expect.any(FlagClient)
      );
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('should return custom response from onRequest handler', async () => {
      const customResponse = { type: 'custom' };
      const onRequest = jest.fn().mockResolvedValue(customResponse);
      const middleware = createMiddleware({ onRequest });

      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      const response = await middleware(mockRequest);

      expect(response).toEqual(customResponse);
      expect(NextResponse.next).not.toHaveBeenCalled();
    });

    it('should provide FlagClient instance to onRequest handler', async () => {
      let receivedClient: FlagClient | null = null;
      const onRequest = jest.fn().mockImplementation((req, client) => {
        receivedClient = client;
      });

      const middleware = createMiddleware({ onRequest });
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      await middleware(mockRequest);

      expect(receivedClient).toBeInstanceOf(FlagClient);
    });

    it('should handle errors in onRequest handler', async () => {
      const onRequest = jest.fn().mockRejectedValue(new Error('Handler error'));
      const middleware = createMiddleware({ onRequest });

      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      await expect(middleware(mockRequest)).rejects.toThrow('Handler error');
    });

    it('should work without config parameter', async () => {
      const middleware = createMiddleware();
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      const response = await middleware(mockRequest);

      expect(response).toEqual({ type: 'next' });
    });
  });

  describe('redirectIfEnabled', () => {
    beforeEach(() => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should redirect if flag is enabled', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const response = await redirectIfEnabled(
        mockRequest,
        'test-flag',
        '/new-page'
      );

      expect(response).not.toBeNull();
      expect(NextResponse.redirect).toHaveBeenCalledWith(
        new URL('/new-page', mockRequest.url)
      );
    });

    it('should return null if flag is disabled', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(false);

      const response = await redirectIfEnabled(
        mockRequest,
        'test-flag',
        '/new-page'
      );

      expect(response).toBeNull();
      expect(NextResponse.redirect).not.toHaveBeenCalled();
    });

    it('should merge provided context', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const customContext = { user_id: 'custom-user' };
      await redirectIfEnabled(
        mockRequest,
        'test-flag',
        '/new-page',
        customContext
      );

      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: 'custom-user',
        })
      );
    });

    it('should handle absolute redirect URLs', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      await redirectIfEnabled(
        mockRequest,
        'test-flag',
        'https://other-domain.com/page'
      );

      expect(NextResponse.redirect).toHaveBeenCalledWith(
        new URL('https://other-domain.com/page', mockRequest.url)
      );
    });
  });

  describe('rewriteIfEnabled', () => {
    beforeEach(() => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should rewrite if flag is enabled', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
        nextUrl: { pathname: '/current' },
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const response = await rewriteIfEnabled(
        mockRequest,
        'test-flag',
        '/beta/current'
      );

      expect(response).not.toBeNull();
      expect(NextResponse.rewrite).toHaveBeenCalledWith(
        new URL('/beta/current', mockRequest.url)
      );
    });

    it('should return null if flag is disabled', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(false);

      const response = await rewriteIfEnabled(
        mockRequest,
        'test-flag',
        '/beta/current'
      );

      expect(response).toBeNull();
      expect(NextResponse.rewrite).not.toHaveBeenCalled();
    });

    it('should merge provided context', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/current',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const customContext = { region: 'us-west' };
      await rewriteIfEnabled(
        mockRequest,
        'test-flag',
        '/new-page',
        customContext
      );

      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          region: 'us-west',
        })
      );
    });

    it('should support dynamic rewrite paths', async () => {
      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/product/123',
        nextUrl: { pathname: '/product/123' },
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      await rewriteIfEnabled(
        mockRequest,
        'test-flag',
        '/beta' + (mockRequest.nextUrl as any).pathname
      );

      expect(NextResponse.rewrite).toHaveBeenCalledWith(
        new URL('/beta/product/123', mockRequest.url)
      );
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });
    });

    it('should support maintenance mode use case', async () => {
      const middleware = createMiddleware({
        async onRequest(request, client) {
          const context = getRequestContext(request);
          const showMaintenance = await client.isEnabled(
            'maintenance-mode',
            context
          );

          if (showMaintenance) {
            return NextResponse.rewrite(
              new URL('/maintenance', request.url)
            );
          }
        },
      });

      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/page',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const response = await middleware(mockRequest);

      expect(NextResponse.rewrite).toHaveBeenCalledWith(
        new URL('/maintenance', mockRequest.url)
      );
    });

    it('should support A/B testing use case', async () => {
      const middleware = createMiddleware({
        async onRequest(request, client) {
          if (request.url.includes('/home')) {
            const context = getRequestContext(request);
            const useBetaUI = await client.isEnabled('beta-ui', context);

            if (useBetaUI) {
              return NextResponse.rewrite(
                new URL('/beta/home', request.url)
              );
            }
          }
        },
      });

      const mockRequest = {
        cookies: {
          get: jest.fn((name) => {
            if (name === 'user_id') return { value: 'user-123' };
            return undefined;
          }),
        },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com/home',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      const response = await middleware(mockRequest);

      expect(NextResponse.rewrite).toHaveBeenCalledWith(
        new URL('/beta/home', mockRequest.url)
      );
    });

    it('should support gradual rollout with context', async () => {
      const mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            const cookies: Record<string, any> = {
              user_id: { value: 'premium-user' },
              session_id: { value: 'session-xyz' },
            };
            return cookies[name];
          }),
        },
        headers: { get: jest.fn(() => 'en-US,en;q=0.9') },
        url: 'https://example.com/feature',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockResolvedValue(true);

      await isEnabledInMiddleware(mockRequest, 'premium-feature');

      expect(FlagClient.prototype.isEnabled).toHaveBeenCalledWith(
        'premium-feature',
        expect.objectContaining({
          user_id: 'premium-user',
          session_id: 'session-xyz',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle client initialization with invalid API key format', () => {
      // Note: The current SDK doesn't throw on invalid key format,
      // so we test that it initializes but may fail during API calls
      expect(() => {
        initMiddlewareClient({ apiKey: 'invalid-key', enableRealtime: false });
      }).not.toThrow();
    });

    it('should propagate flag evaluation errors', async () => {
      initMiddlewareClient({ apiKey: 'sdk_test_key', enableRealtime: false });

      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
        url: 'https://example.com',
      } as unknown as NextRequest;

      jest.spyOn(FlagClient.prototype, 'isEnabled').mockRejectedValue(
        new Error('Network timeout')
      );

      await expect(
        isEnabledInMiddleware(mockRequest, 'test-flag')
      ).rejects.toThrow('Network timeout');
    });

    it('should handle missing client gracefully', async () => {
      jest.resetModules();
      const { isEnabledInMiddleware: isEnabled } = require('../src/middleware');

      const mockRequest = {
        cookies: { get: jest.fn(() => undefined) },
        headers: { get: jest.fn(() => null) },
      } as unknown as NextRequest;

      await expect(isEnabled(mockRequest, 'test-flag')).rejects.toThrow(
        'Middleware client not initialized'
      );
    });
  });
});
