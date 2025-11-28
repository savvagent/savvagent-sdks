/**
 * Unit tests for type definitions
 */

import {
  FlagEvaluation,
  FlagError,
  MCPConfig,
  ErrorQuery,
  ExternalError,
  ErrorCorrelation,
  MCPWebhookPayload,
  MCPHealthStatus,
} from '../src/types';

describe('Type Definitions', () => {
  describe('FlagEvaluation', () => {
    it('should allow creation of valid flag evaluation', () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      expect(evaluation.id).toBe('eval-123');
      expect(evaluation.result).toBe(true);
    });

    it('should allow optional fields', () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: false,
        context: { userId: 'user-789' },
        durationMs: 25,
        traceId: 'trace-abc',
        timestamp: new Date().toISOString(),
      };

      expect(evaluation.context).toBeDefined();
      expect(evaluation.durationMs).toBe(25);
      expect(evaluation.traceId).toBe('trace-abc');
    });

    it('should allow any context values', () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        context: {
          userId: 'user-123',
          userRole: 'admin',
          features: ['feature1', 'feature2'],
          metadata: { nested: { value: 123 } },
        },
        timestamp: new Date().toISOString(),
      };

      expect(evaluation.context?.userId).toBe('user-123');
      expect(evaluation.context?.features).toHaveLength(2);
    });
  });

  describe('FlagError', () => {
    it('should allow creation of valid flag error', () => {
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

      expect(error.errorType).toBe('TypeError');
      expect(error.flagEnabled).toBe(true);
    });

    it('should allow optional fields', () => {
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: false,
        errorType: 'ReferenceError',
        errorMessage: 'x is not defined',
        stackTrace: 'at foo (file.js:1:1)',
        context: { browser: 'Chrome' },
        traceId: 'trace-xyz',
        timestamp: new Date().toISOString(),
      };

      expect(error.stackTrace).toBeDefined();
      expect(error.context).toBeDefined();
      expect(error.traceId).toBe('trace-xyz');
    });
  });

  describe('MCPConfig', () => {
    it('should allow creation of valid config', () => {
      const config: MCPConfig = {
        organizationId: 'org-123',
        integrationId: 'integration-456',
        serverType: 'sentry',
        config: { apiKey: 'test-key', projectId: 'project-123' },
        enabled: true,
      };

      expect(config.serverType).toBe('sentry');
      expect(config.enabled).toBe(true);
    });

    it('should allow any config values', () => {
      const config: MCPConfig = {
        organizationId: 'org-123',
        integrationId: 'integration-456',
        serverType: 'custom',
        config: {
          url: 'https://api.example.com',
          timeout: 5000,
          retries: 3,
          headers: { 'X-API-Key': 'key' },
        },
        enabled: false,
      };

      expect(config.config.timeout).toBe(5000);
      expect(config.config.retries).toBe(3);
    });
  });

  describe('ErrorQuery', () => {
    it('should allow basic query', () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
      };

      expect(query.organizationId).toBe('org-123');
    });

    it('should allow optional filters', () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
        flagId: 'flag-456',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-12-31'),
        errorType: 'TypeError',
        limit: 100,
      };

      expect(query.flagId).toBe('flag-456');
      expect(query.limit).toBe(100);
      expect(query.startTime).toBeInstanceOf(Date);
    });

    it('should allow partial queries', () => {
      const query1: ErrorQuery = {
        organizationId: 'org-123',
        startTime: new Date(),
      };

      const query2: ErrorQuery = {
        organizationId: 'org-123',
        errorType: 'Error',
        limit: 50,
      };

      expect(query1.startTime).toBeDefined();
      expect(query2.limit).toBe(50);
    });
  });

  describe('ExternalError', () => {
    it('should allow minimal external error', () => {
      const error: ExternalError = {
        id: 'ext-error-1',
        errorType: 'Exception',
        errorMessage: 'Test error',
        timestamp: new Date().toISOString(),
      };

      expect(error.id).toBe('ext-error-1');
      expect(error.errorType).toBe('Exception');
    });

    it('should allow optional fields', () => {
      const error: ExternalError = {
        id: 'ext-error-1',
        errorType: 'DatabaseError',
        errorMessage: 'Connection failed',
        stackTrace: 'at connect (db.js:10:5)',
        timestamp: new Date().toISOString(),
        count: 42,
        tags: { environment: 'production', service: 'api' },
        metadata: { server: 'us-east-1', version: '1.0.0' },
      };

      expect(error.count).toBe(42);
      expect(error.tags?.environment).toBe('production');
      expect(error.metadata?.version).toBe('1.0.0');
    });
  });

  describe('ErrorCorrelation', () => {
    it('should allow creation of correlation', () => {
      const correlation: ErrorCorrelation = {
        flagId: 'flag-123',
        flagKey: 'test-flag',
        externalError: {
          id: 'ext-error-1',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: new Date().toISOString(),
        },
        correlationScore: 0.85,
        errorRateBefore: 0.05,
        errorRateAfter: 0.25,
        confidence: 'high',
      };

      expect(correlation.correlationScore).toBe(0.85);
      expect(correlation.confidence).toBe('high');
    });

    it('should allow different confidence levels', () => {
      const high: ErrorCorrelation = {
        flagId: 'flag-1',
        flagKey: 'flag-1',
        externalError: {
          id: 'error-1',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: new Date().toISOString(),
        },
        correlationScore: 0.9,
        errorRateBefore: 0.01,
        errorRateAfter: 0.5,
        confidence: 'high',
      };

      const medium: ErrorCorrelation = {
        ...high,
        correlationScore: 0.6,
        confidence: 'medium',
      };

      const low: ErrorCorrelation = {
        ...high,
        correlationScore: 0.3,
        confidence: 'low',
      };

      expect(high.confidence).toBe('high');
      expect(medium.confidence).toBe('medium');
      expect(low.confidence).toBe('low');
    });
  });

  describe('MCPWebhookPayload', () => {
    it('should allow flag_evaluation payload', () => {
      const payload: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: true,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      expect(payload.eventType).toBe('flag_evaluation');
      const data = payload.data as FlagEvaluation;
      expect(data.result).toBe(true);
    });

    it('should allow flag_error payload', () => {
      const payload: MCPWebhookPayload = {
        eventType: 'flag_error',
        data: {
          id: 'error-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          flagEnabled: true,
          errorType: 'Error',
          errorMessage: 'Test error',
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      expect(payload.eventType).toBe('flag_error');
      const data = payload.data as FlagError;
      expect(data.errorType).toBe('Error');
    });
  });

  describe('MCPHealthStatus', () => {
    it('should allow healthy status', () => {
      const status: MCPHealthStatus = {
        healthy: true,
        message: 'All systems operational',
        lastCheck: new Date().toISOString(),
      };

      expect(status.healthy).toBe(true);
      expect(status.message).toBeDefined();
    });

    it('should allow unhealthy status', () => {
      const status: MCPHealthStatus = {
        healthy: false,
        message: 'Service unavailable',
        lastCheck: new Date().toISOString(),
      };

      expect(status.healthy).toBe(false);
    });

    it('should allow status without message', () => {
      const status: MCPHealthStatus = {
        healthy: true,
        lastCheck: new Date().toISOString(),
      };

      expect(status.message).toBeUndefined();
    });
  });

  describe('Type compatibility', () => {
    it('should allow FlagEvaluation in webhook payload', () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      const payload: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: evaluation,
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      expect(payload.data).toBe(evaluation);
    });

    it('should allow FlagError in webhook payload', () => {
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

      const payload: MCPWebhookPayload = {
        eventType: 'flag_error',
        data: error,
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      expect(payload.data).toBe(error);
    });
  });
});
