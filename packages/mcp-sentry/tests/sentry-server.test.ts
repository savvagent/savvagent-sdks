/**
 * Unit tests for SentryMCPServer
 * @jest-environment node
 */

import { SentryMCPServer, SentryConfig } from '../src/sentry-server';
import * as Sentry from '@sentry/node';
import axios from 'axios';
import {
  MCPConfig,
  FlagEvaluation,
  FlagError,
  ErrorQuery,
  ExternalError,
} from '@savvagent/mcp-sdk';

// Mock dependencies
jest.mock('@sentry/node');
jest.mock('axios');

describe('SentryMCPServer', () => {
  let server: SentryMCPServer;
  let mockSentryConfig: SentryConfig;
  let mockMCPConfig: MCPConfig;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock Sentry config
    mockSentryConfig = {
      dsn: 'https://test@sentry.io/123456',
      authToken: 'test-auth-token',
      organization: 'test-org',
      project: 'test-project',
      environment: 'test',
    };

    // Setup MCP config
    mockMCPConfig = {
      organizationId: 'org-123',
      integrationId: 'integration-456',
      serverType: 'sentry',
      config: mockSentryConfig,
      enabled: true,
    };

    // Setup axios mock
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    // Create server instance
    server = new SentryMCPServer(mockMCPConfig);
  });

  describe('Constructor', () => {
    test('should create instance with valid config', () => {
      expect(server).toBeInstanceOf(SentryMCPServer);
      expect(server.isInitialized()).toBe(false);
    });

    test('should store config correctly', () => {
      const config = server.getConfig();
      expect(config.organizationId).toBe('org-123');
      expect(config.integrationId).toBe('integration-456');
      expect(config.serverType).toBe('sentry');
    });
  });

  describe('initialize()', () => {
    test('should initialize Sentry SDK with correct config', async () => {
      await server.initialize();

      expect(Sentry.init).toHaveBeenCalledWith({
        dsn: mockSentryConfig.dsn,
        environment: mockSentryConfig.environment,
        tracesSampleRate: 1.0,
      });
    });

    test('should initialize Sentry SDK with default environment if not provided', async () => {
      const configWithoutEnv = {
        ...mockMCPConfig,
        config: {
          ...mockSentryConfig,
          environment: undefined,
        },
      };
      server = new SentryMCPServer(configWithoutEnv);

      await server.initialize();

      expect(Sentry.init).toHaveBeenCalledWith({
        dsn: mockSentryConfig.dsn,
        environment: 'production',
        tracesSampleRate: 1.0,
      });
    });

    test('should create axios client with correct config', async () => {
      await server.initialize();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://sentry.io/api/0',
        headers: {
          Authorization: `Bearer ${mockSentryConfig.authToken}`,
          'Content-Type': 'application/json',
        },
      });
    });

    test('should set initialized flag to true', async () => {
      expect(server.isInitialized()).toBe(false);
      await server.initialize();
      expect(server.isInitialized()).toBe(true);
    });

    test('should log initialization success', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await server.initialize();

      expect(consoleSpy).toHaveBeenCalledWith('[SentryMCP] Initialized successfully');

      consoleSpy.mockRestore();
    });
  });

  describe('onFlagEvaluation()', () => {
    const mockEvaluation: FlagEvaluation = {
      id: 'eval-123',
      organizationId: 'org-123',
      flagId: 'flag-456',
      flagKey: 'test-flag',
      result: true,
      context: { userId: 'user-789', email: 'test@example.com' },
      durationMs: 5,
      traceId: 'trace-abc',
      timestamp: '2025-01-15T10:00:00.000Z',
    };

    test('should throw error if not initialized', async () => {
      await expect(server.onFlagEvaluation(mockEvaluation)).rejects.toThrow(
        'Server not initialized'
      );
    });

    test('should add breadcrumb to Sentry with correct data', async () => {
      await server.initialize();
      await server.onFlagEvaluation(mockEvaluation);

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'feature-flag',
        message: `Flag "test-flag" evaluated to true`,
        level: 'info',
        data: {
          flag_key: 'test-flag',
          flag_id: 'flag-456',
          result: true,
          trace_id: 'trace-abc',
          context: { userId: 'user-789', email: 'test@example.com' },
        },
        timestamp: new Date(mockEvaluation.timestamp).getTime() / 1000,
      });
    });

    test('should handle evaluation with result false', async () => {
      await server.initialize();
      const evaluation = { ...mockEvaluation, result: false };

      await server.onFlagEvaluation(evaluation);

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Flag "test-flag" evaluated to false',
          data: expect.objectContaining({ result: false }),
        })
      );
    });

    test('should handle evaluation without optional fields', async () => {
      await server.initialize();
      const minimalEvaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await server.onFlagEvaluation(minimalEvaluation);

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flag_key: 'test-flag',
            context: undefined,
            trace_id: undefined,
          }),
        })
      );
    });

    test('should log breadcrumb addition', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await server.initialize();

      await server.onFlagEvaluation(mockEvaluation);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[SentryMCP] Added breadcrumb for flag: test-flag = true'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('onFlagError()', () => {
    const mockFlagError: FlagError = {
      id: 'error-123',
      organizationId: 'org-123',
      flagId: 'flag-456',
      flagKey: 'test-flag',
      flagEnabled: true,
      errorType: 'TypeError',
      errorMessage: 'Cannot read property of undefined',
      stackTrace: 'Error: Cannot read property of undefined\n    at test.js:10:5',
      context: { userId: 'user-789' },
      traceId: 'trace-abc',
      timestamp: '2025-01-15T10:00:00.000Z',
    };

    test('should throw error if not initialized', async () => {
      await expect(server.onFlagError(mockFlagError)).rejects.toThrow(
        'Server not initialized'
      );
    });

    test('should capture exception in Sentry with correct data', async () => {
      await server.initialize();
      await server.onFlagError(mockFlagError);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        {
          tags: {
            flag_key: 'test-flag',
            flag_id: 'flag-456',
            flag_enabled: 'true',
            error_type: 'TypeError',
          },
          contexts: {
            'feature-flag': {
              key: 'test-flag',
              id: 'flag-456',
              enabled: true,
            },
          },
          extra: {
            userId: 'user-789',
            trace_id: 'trace-abc',
            stack_trace: 'Error: Cannot read property of undefined\n    at test.js:10:5',
          },
          level: 'error',
        }
      );
    });

    test('should create Error with correct message', async () => {
      await server.initialize();
      await server.onFlagError(mockFlagError);

      const capturedError = (Sentry.captureException as jest.Mock).mock.calls[0][0];
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe('Cannot read property of undefined');
    });

    test('should handle error with flag disabled', async () => {
      await server.initialize();
      const errorWithDisabledFlag = { ...mockFlagError, flagEnabled: false };

      await server.onFlagError(errorWithDisabledFlag);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            flag_enabled: 'false',
          }),
          contexts: {
            'feature-flag': expect.objectContaining({
              enabled: false,
            }),
          },
        })
      );
    });

    test('should handle error without optional fields', async () => {
      await server.initialize();
      const minimalError: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'Error',
        errorMessage: 'Something went wrong',
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await server.onFlagError(minimalError);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          extra: expect.objectContaining({
            trace_id: undefined,
            stack_trace: undefined,
          }),
        })
      );
    });

    test('should log error capture', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await server.initialize();

      await server.onFlagError(mockFlagError);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[SentryMCP] Captured error for flag: test-flag (TypeError)'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('queryErrors()', () => {
    const mockQuery: ErrorQuery = {
      organizationId: 'org-123',
      flagId: 'flag-456',
      startTime: new Date('2025-01-15T00:00:00.000Z'),
      endTime: new Date('2025-01-15T23:59:59.999Z'),
      errorType: 'TypeError',
      limit: 10,
    };

    const mockSentryIssues = [
      {
        id: 'issue-1',
        type: 'TypeError',
        title: 'Cannot read property of undefined',
        culprit: 'test.js',
        metadata: {
          type: 'TypeError',
          value: 'at test.js:10:5',
        },
        lastSeen: '2025-01-15T10:00:00.000Z',
        firstSeen: '2025-01-15T09:00:00.000Z',
        count: 5,
        level: 'error',
        status: 'unresolved',
        permalink: 'https://sentry.io/issues/issue-1',
        shortId: 'TEST-1',
        isUnhandled: true,
        tags: [
          { key: 'flag_key', value: 'test-flag' },
          { key: 'flag_id', value: 'flag-456' },
          { key: 'environment', value: 'test' },
        ],
      },
      {
        id: 'issue-2',
        title: 'ReferenceError: x is not defined',
        culprit: 'app.js',
        lastSeen: '2025-01-15T11:00:00.000Z',
        count: 3,
        level: 'warning',
        status: 'resolved',
        permalink: 'https://sentry.io/issues/issue-2',
        shortId: 'TEST-2',
        isUnhandled: false,
        tags: [],
      },
    ];

    beforeEach(async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({ data: mockSentryIssues });
    });

    test('should throw error if not initialized', async () => {
      const uninitializedServer = new SentryMCPServer(mockMCPConfig);
      await expect(uninitializedServer.queryErrors(mockQuery)).rejects.toThrow(
        'Server not initialized'
      );
    });

    test('should query Sentry API with correct parameters', async () => {
      await server.queryErrors(mockQuery);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/organizations/test-org/issues/',
        {
          params: {
            project: 'test-project',
            statsPeriod: '24h',
            start: '2025-01-15T00:00:00.000Z',
            end: '2025-01-15T23:59:59.999Z',
            per_page: 10,
          },
        }
      );
    });

    test('should query without time range if not provided', async () => {
      const queryWithoutTime: ErrorQuery = {
        organizationId: 'org-123',
      };

      await server.queryErrors(queryWithoutTime);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/organizations/test-org/issues/',
        {
          params: {
            project: 'test-project',
            statsPeriod: '24h',
          },
        }
      );
    });

    test('should query without limit if not provided', async () => {
      const queryWithoutLimit: ErrorQuery = {
        organizationId: 'org-123',
      };

      await server.queryErrors(queryWithoutLimit);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/organizations/test-org/issues/',
        {
          params: expect.not.objectContaining({
            per_page: expect.anything(),
          }),
        }
      );
    });

    test('should transform Sentry issues to ExternalError format', async () => {
      const errors = await server.queryErrors(mockQuery);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toEqual({
        id: 'issue-1',
        errorType: 'TypeError',
        errorMessage: 'Cannot read property of undefined',
        stackTrace: 'at test.js:10:5',
        timestamp: '2025-01-15T10:00:00.000Z',
        count: 5,
        tags: {
          level: 'error',
          status: 'unresolved',
          flag_key: 'test-flag',
          flag_id: 'flag-456',
        },
        metadata: {
          permalink: 'https://sentry.io/issues/issue-1',
          shortId: 'TEST-1',
          status: 'unresolved',
          isUnhandled: true,
        },
      });
    });

    test('should handle issues without metadata', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: [
          {
            id: 'issue-3',
            title: 'Test error',
            lastSeen: '2025-01-15T12:00:00.000Z',
            level: 'error',
            status: 'unresolved',
            permalink: 'https://sentry.io/issues/issue-3',
            shortId: 'TEST-3',
            isUnhandled: false,
            tags: [],
          },
        ],
      });

      const errors = await server.queryErrors(mockQuery);

      expect(errors[0]).toEqual({
        id: 'issue-3',
        errorType: 'Error',
        errorMessage: 'Test error',
        stackTrace: undefined,
        timestamp: '2025-01-15T12:00:00.000Z',
        count: 1,
        tags: {
          level: 'error',
          status: 'unresolved',
        },
        metadata: {
          permalink: 'https://sentry.io/issues/issue-3',
          shortId: 'TEST-3',
          status: 'unresolved',
          isUnhandled: false,
        },
      });
    });

    test('should extract only flag-related tags', async () => {
      const errors = await server.queryErrors(mockQuery);

      expect(errors[0].tags).toEqual({
        level: 'error',
        status: 'unresolved',
        flag_key: 'test-flag',
        flag_id: 'flag-456',
      });
      expect(errors[0].tags).not.toHaveProperty('environment');
    });

    test('should handle empty results', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const errors = await server.queryErrors(mockQuery);

      expect(errors).toEqual([]);
    });

    test('should log query results', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await server.queryErrors(mockQuery);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[SentryMCP] Queried 2 errors from Sentry'
      );

      consoleSpy.mockRestore();
    });

    test('should handle API errors and rethrow', async () => {
      const apiError = new Error('API Error');
      mockAxiosInstance.get.mockRejectedValue(apiError);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(server.queryErrors(mockQuery)).rejects.toThrow('API Error');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SentryMCP] Error querying Sentry:',
        apiError
      );

      consoleErrorSpy.mockRestore();
    });

    test('should use firstSeen if lastSeen is not available', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: [
          {
            id: 'issue-4',
            title: 'Test error',
            firstSeen: '2025-01-15T08:00:00.000Z',
            level: 'error',
            status: 'unresolved',
            permalink: 'https://sentry.io/issues/issue-4',
            shortId: 'TEST-4',
            isUnhandled: false,
            tags: [],
          },
        ],
      });

      const errors = await server.queryErrors(mockQuery);

      expect(errors[0].timestamp).toBe('2025-01-15T08:00:00.000Z');
    });
  });

  describe('healthCheck()', () => {
    test('should return healthy status when connection succeeds', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({ data: { name: 'test-org' } });

      const health = await server.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toBe('Sentry connection healthy');
      expect(health.lastCheck).toBeDefined();
    });

    test('should query organization endpoint', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({ data: { name: 'test-org' } });

      await server.healthCheck();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/organizations/test-org/');
    });

    test('should return unhealthy status when connection fails', async () => {
      await server.initialize();
      const error = new Error('Connection failed');
      mockAxiosInstance.get.mockRejectedValue(error);

      const health = await server.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('Sentry connection failed');
      expect(health.lastCheck).toBeDefined();
    });

    test('should include error message in unhealthy response', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockRejectedValue(new Error('Network timeout'));

      const health = await server.healthCheck();

      expect(health.message).toContain('Network timeout');
    });

    test('should return valid ISO timestamp', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      const health = await server.healthCheck();

      expect(() => new Date(health.lastCheck)).not.toThrow();
      expect(new Date(health.lastCheck).toISOString()).toBe(health.lastCheck);
    });
  });

  describe('shutdown()', () => {
    test('should close Sentry client with timeout', async () => {
      await server.initialize();
      await server.shutdown();

      expect(Sentry.close).toHaveBeenCalledWith(2000);
    });

    test('should call parent shutdown method', async () => {
      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      await server.shutdown();

      expect(server.isInitialized()).toBe(false);
    });

    test('should not throw if Sentry client is not initialized', async () => {
      await expect(server.shutdown()).resolves.not.toThrow();
    });

    test('should log shutdown message', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await server.initialize();

      await server.shutdown();

      expect(consoleSpy).toHaveBeenCalledWith('[SentryMCP] Shutdown complete');

      consoleSpy.mockRestore();
    });
  });

  describe('extractFlagTags() - private method testing via queryErrors', () => {
    test('should extract tags with flag_ prefix', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({
        data: [
          {
            id: 'issue-1',
            title: 'Test error',
            lastSeen: '2025-01-15T10:00:00.000Z',
            level: 'error',
            status: 'unresolved',
            permalink: 'https://sentry.io/issues/issue-1',
            shortId: 'TEST-1',
            isUnhandled: false,
            tags: [
              { key: 'flag_enabled', value: 'true' },
              { key: 'flag_variant', value: 'control' },
              { key: 'other_tag', value: 'value' },
            ],
          },
        ],
      });

      const errors = await server.queryErrors({ organizationId: 'org-123' });

      expect(errors[0].tags).toHaveProperty('flag_enabled', 'true');
      expect(errors[0].tags).toHaveProperty('flag_variant', 'control');
      expect(errors[0].tags).not.toHaveProperty('other_tag');
    });

    test('should handle null or non-array tags', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({
        data: [
          {
            id: 'issue-1',
            title: 'Test error',
            lastSeen: '2025-01-15T10:00:00.000Z',
            level: 'error',
            status: 'unresolved',
            permalink: 'https://sentry.io/issues/issue-1',
            shortId: 'TEST-1',
            isUnhandled: false,
            tags: null,
          },
        ],
      });

      const errors = await server.queryErrors({ organizationId: 'org-123' });

      expect(errors[0].tags).toEqual({
        level: 'error',
        status: 'unresolved',
      });
    });

    test('should handle empty tags array', async () => {
      await server.initialize();
      mockAxiosInstance.get.mockResolvedValue({
        data: [
          {
            id: 'issue-1',
            title: 'Test error',
            lastSeen: '2025-01-15T10:00:00.000Z',
            level: 'error',
            status: 'unresolved',
            permalink: 'https://sentry.io/issues/issue-1',
            shortId: 'TEST-1',
            isUnhandled: false,
            tags: [],
          },
        ],
      });

      const errors = await server.queryErrors({ organizationId: 'org-123' });

      expect(errors[0].tags).toEqual({
        level: 'error',
        status: 'unresolved',
      });
    });
  });

  describe('Integration scenarios', () => {
    test('should handle complete flag evaluation flow', async () => {
      await server.initialize();

      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'new-feature',
        result: true,
        context: { userId: 'user-789' },
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await server.onFlagEvaluation(evaluation);

      expect(Sentry.addBreadcrumb).toHaveBeenCalled();
    });

    test('should handle complete error flow', async () => {
      await server.initialize();

      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'new-feature',
        flagEnabled: true,
        errorType: 'Error',
        errorMessage: 'Test error',
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await server.onFlagError(error);

      expect(Sentry.captureException).toHaveBeenCalled();
    });

    test('should handle concurrent flag evaluations', async () => {
      await server.initialize();

      const evaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'flag-1',
          result: true,
          timestamp: '2025-01-15T10:00:00.000Z',
        },
        {
          id: 'eval-2',
          organizationId: 'org-123',
          flagId: 'flag-2',
          flagKey: 'flag-2',
          result: false,
          timestamp: '2025-01-15T10:00:01.000Z',
        },
        {
          id: 'eval-3',
          organizationId: 'org-123',
          flagId: 'flag-3',
          flagKey: 'flag-3',
          result: true,
          timestamp: '2025-01-15T10:00:02.000Z',
        },
      ];

      await Promise.all(evaluations.map((e) => server.onFlagEvaluation(e)));

      expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(3);
    });

    test('should handle server lifecycle: init -> use -> shutdown', async () => {
      expect(server.isInitialized()).toBe(false);

      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      await server.onFlagEvaluation({
        id: 'eval-1',
        organizationId: 'org-123',
        flagId: 'flag-1',
        flagKey: 'test',
        result: true,
        timestamp: '2025-01-15T10:00:00.000Z',
      });

      await server.shutdown();
      expect(server.isInitialized()).toBe(false);
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle malformed timestamps gracefully', async () => {
      await server.initialize();

      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: 'invalid-timestamp',
      };

      await server.onFlagEvaluation(evaluation);

      const call = (Sentry.addBreadcrumb as jest.Mock).mock.calls[0][0];
      expect(call.timestamp).toBeDefined();
      expect(typeof call.timestamp).toBe('number');
    });

    test('should handle very large context objects', async () => {
      await server.initialize();

      const largeContext: Record<string, any> = {};
      for (let i = 0; i < 1000; i++) {
        largeContext[`key${i}`] = `value${i}`;
      }

      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        context: largeContext,
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await expect(server.onFlagEvaluation(evaluation)).resolves.not.toThrow();
    });

    test('should handle special characters in flag keys', async () => {
      await server.initialize();

      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'flag-with-special-chars-!@#$%',
        result: true,
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await server.onFlagEvaluation(evaluation);

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flag_key: 'flag-with-special-chars-!@#$%',
          }),
        })
      );
    });

    test('should handle empty error messages', async () => {
      await server.initialize();

      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'Error',
        errorMessage: '',
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      await server.onFlagError(error);

      const capturedError = (Sentry.captureException as jest.Mock).mock.calls[0][0];
      expect(capturedError.message).toBe('');
    });

    test('should handle network timeout in queryErrors', async () => {
      await server.initialize();

      const timeoutError = new Error('ETIMEDOUT');
      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      await expect(
        server.queryErrors({ organizationId: 'org-123' })
      ).rejects.toThrow('ETIMEDOUT');
    });

    test('should handle rate limiting errors', async () => {
      await server.initialize();

      const rateLimitError = {
        response: {
          status: 429,
          data: { detail: 'Rate limit exceeded' },
        },
      };
      mockAxiosInstance.get.mockRejectedValue(rateLimitError);

      await expect(
        server.queryErrors({ organizationId: 'org-123' })
      ).rejects.toEqual(rateLimitError);
    });
  });
});
