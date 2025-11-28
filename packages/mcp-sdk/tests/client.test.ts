/**
 * Unit tests for MCPClient
 */

import axios from 'axios';
import { MCPClient } from '../src/client';
import { FlagEvaluation, FlagError, ErrorQuery, ExternalError } from '../src/types';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MCPClient', () => {
  let client: MCPClient;
  let mockAxiosInstance: any;

  const testConfig = {
    apiUrl: 'https://api.savvagent.com',
    apiKey: 'test-api-key-123',
    organizationId: 'org-123',
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ data: {} }),
      get: jest.fn().mockResolvedValue({ data: [] }),
    };

    // Mock axios.create to return our mock instance
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    // Create client instance
    client = new MCPClient(testConfig);
  });

  describe('constructor', () => {
    it('should create axios instance with correct config', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: testConfig.apiUrl,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testConfig.apiKey}`,
        },
      });
    });

    it('should store config', () => {
      expect(client).toBeDefined();
      expect((client as any).config).toEqual(testConfig);
    });
  });

  describe('sendEvaluation', () => {
    it('should send flag evaluation to API', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      await client.sendEvaluation(evaluation);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/evaluations',
        evaluation
      );
    });

    it('should send evaluation with optional fields', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: false,
        context: { userId: 'user-789' },
        durationMs: 42,
        traceId: 'trace-abc',
        timestamp: new Date().toISOString(),
      };

      await client.sendEvaluation(evaluation);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/evaluations',
        evaluation
      );
    });

    it('should handle API errors', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      const error = new Error('API Error');
      mockAxiosInstance.post.mockRejectedValueOnce(error);

      await expect(client.sendEvaluation(evaluation)).rejects.toThrow('API Error');
    });
  });

  describe('sendError', () => {
    it('should send error to API', async () => {
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'TypeError',
        errorMessage: 'Cannot read property of undefined',
        timestamp: new Date().toISOString(),
      };

      await client.sendError(error);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/mcp/errors', error);
    });

    it('should send error with stack trace and context', async () => {
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'ReferenceError',
        errorMessage: 'x is not defined',
        stackTrace: 'at foo (file.js:1:1)',
        context: { userAgent: 'Mozilla' },
        traceId: 'trace-xyz',
        timestamp: new Date().toISOString(),
      };

      await client.sendError(error);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/mcp/errors', error);
    });

    it('should handle network errors', async () => {
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'TypeError',
        errorMessage: 'Test error',
        timestamp: new Date().toISOString(),
      };

      mockAxiosInstance.post.mockRejectedValueOnce(new Error('Network Error'));

      await expect(client.sendError(error)).rejects.toThrow('Network Error');
    });
  });

  describe('queryEvaluations', () => {
    it('should query evaluations with basic params', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
      };

      const mockEvaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag-1',
          result: true,
          timestamp: new Date().toISOString(),
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockEvaluations });

      const result = await client.queryEvaluations(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/mcp/evaluations', {
        params: query,
      });
      expect(result).toEqual(mockEvaluations);
    });

    it('should query evaluations with all filters', async () => {
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-12-31');
      const query: ErrorQuery = {
        organizationId: 'org-123',
        flagId: 'flag-456',
        startTime,
        endTime,
        limit: 100,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });

      await client.queryEvaluations(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/mcp/evaluations', {
        params: query,
      });
    });

    it('should return empty array when no evaluations found', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });

      const result = await client.queryEvaluations(query);

      expect(result).toEqual([]);
    });
  });

  describe('queryErrors', () => {
    it('should query errors with basic params', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
      };

      const mockErrors: FlagError[] = [
        {
          id: 'error-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          flagEnabled: true,
          errorType: 'Error',
          errorMessage: 'Test error',
          timestamp: new Date().toISOString(),
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockErrors });

      const result = await client.queryErrors(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/mcp/errors', {
        params: query,
      });
      expect(result).toEqual(mockErrors);
    });

    it('should query errors with error type filter', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
        errorType: 'TypeError',
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] });

      await client.queryErrors(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/mcp/errors', {
        params: query,
      });
    });

    it('should handle query errors', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
      };

      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Query failed'));

      await expect(client.queryErrors(query)).rejects.toThrow('Query failed');
    });
  });

  describe('sendExternalErrors', () => {
    it('should send external errors to API', async () => {
      const errors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'Exception',
          errorMessage: 'External error',
          timestamp: new Date().toISOString(),
        },
      ];

      await client.sendExternalErrors(errors);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/external-errors',
        {
          organizationId: testConfig.organizationId,
          errors,
        }
      );
    });

    it('should send external errors with metadata', async () => {
      const errors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'DatabaseError',
          errorMessage: 'Connection timeout',
          stackTrace: 'at db.connect()',
          timestamp: new Date().toISOString(),
          count: 42,
          tags: { environment: 'production', service: 'api' },
          metadata: { server: 'us-east-1', version: '1.0.0' },
        },
      ];

      await client.sendExternalErrors(errors);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/external-errors',
        {
          organizationId: testConfig.organizationId,
          errors,
        }
      );
    });

    it('should send multiple external errors', async () => {
      const errors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'Error',
          errorMessage: 'Error 1',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'ext-error-2',
          errorType: 'Error',
          errorMessage: 'Error 2',
          timestamp: new Date().toISOString(),
        },
      ];

      await client.sendExternalErrors(errors);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/external-errors',
        {
          organizationId: testConfig.organizationId,
          errors,
        }
      );
    });

    it('should send empty array of errors', async () => {
      const errors: ExternalError[] = [];

      await client.sendExternalErrors(errors);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/external-errors',
        {
          organizationId: testConfig.organizationId,
          errors,
        }
      );
    });
  });

  describe('getCorrelations', () => {
    it('should get correlations for a flag', async () => {
      const flagId = 'flag-123';
      const mockCorrelations = {
        flagId,
        correlations: [
          {
            errorId: 'error-1',
            score: 0.85,
          },
        ],
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockCorrelations });

      const result = await client.getCorrelations(flagId);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        `/api/mcp/correlations/${flagId}`
      );
      expect(result).toEqual(mockCorrelations);
    });

    it('should handle empty correlations', async () => {
      const flagId = 'flag-456';
      const mockCorrelations = { flagId, correlations: [] };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockCorrelations });

      const result = await client.getCorrelations(flagId);

      expect(result).toEqual(mockCorrelations);
    });

    it('should handle 404 errors for non-existent flags', async () => {
      const flagId = 'non-existent-flag';

      mockAxiosInstance.get.mockRejectedValueOnce({
        response: { status: 404 },
        message: 'Not found',
      });

      await expect(client.getCorrelations(flagId)).rejects.toMatchObject({
        response: { status: 404 },
      });
    });
  });

  describe('edge cases', () => {
    it('should handle malformed API responses', async () => {
      const query: ErrorQuery = { organizationId: 'org-123' };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: null });

      const result = await client.queryEvaluations(query);

      expect(result).toBeNull();
    });

    it('should handle timeout errors', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      mockAxiosInstance.post.mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded',
      });

      await expect(client.sendEvaluation(evaluation)).rejects.toMatchObject({
        code: 'ECONNABORTED',
      });
    });

    it('should handle unauthorized errors', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      await expect(client.sendEvaluation(evaluation)).rejects.toMatchObject({
        response: { status: 401 },
      });
    });

    it('should handle rate limit errors', async () => {
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'Error',
        errorMessage: 'Test',
        timestamp: new Date().toISOString(),
      };

      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 429 },
        message: 'Too Many Requests',
      });

      await expect(client.sendError(error)).rejects.toMatchObject({
        response: { status: 429 },
      });
    });
  });
});
