/**
 * Unit tests for MCPServer
 */

import {
  MCPServer,
  FlagEvaluation,
  FlagError,
  ErrorQuery,
  ExternalError,
  MCPConfig,
  ErrorCorrelation,
} from '../src';

// Create a concrete implementation for testing
class TestMCPServer extends MCPServer {
  public initializeCalled = false;
  public evaluations: FlagEvaluation[] = [];
  public errors: FlagError[] = [];
  public shouldFailInitialize = false;
  public shouldFailOnEvaluation = false;
  public shouldFailOnError = false;
  public shouldFailQueryErrors = false;

  async initialize(): Promise<void> {
    if (this.shouldFailInitialize) {
      throw new Error('Initialize failed');
    }
    this.initialized = true;
    this.initializeCalled = true;
  }

  async onFlagEvaluation(evaluation: FlagEvaluation): Promise<void> {
    if (this.shouldFailOnEvaluation) {
      throw new Error('onFlagEvaluation failed');
    }
    this.evaluations.push(evaluation);
  }

  async onFlagError(error: FlagError): Promise<void> {
    if (this.shouldFailOnError) {
      throw new Error('onFlagError failed');
    }
    this.errors.push(error);
  }

  async queryErrors(query: ErrorQuery): Promise<ExternalError[]> {
    if (this.shouldFailQueryErrors) {
      throw new Error('queryErrors failed');
    }

    // Return mock errors for testing
    return [
      {
        id: 'ext-error-1',
        errorType: 'TypeError',
        errorMessage: 'Test external error',
        timestamp: new Date().toISOString(),
      },
    ];
  }
}

describe('MCPServer', () => {
  let server: TestMCPServer;
  const testConfig: MCPConfig = {
    organizationId: 'org-123',
    integrationId: 'integration-456',
    serverType: 'test-server',
    config: { apiKey: 'test-key' },
    enabled: true,
  };

  beforeEach(() => {
    server = new TestMCPServer(testConfig);
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(server.getConfig()).toEqual(testConfig);
    });

    it('should not be initialized by default', () => {
      expect(server.isInitialized()).toBe(false);
    });

    it('should store config internally', () => {
      const config = server.getConfig();
      expect(config.organizationId).toBe('org-123');
      expect(config.integrationId).toBe('integration-456');
      expect(config.serverType).toBe('test-server');
      expect(config.enabled).toBe(true);
    });
  });

  describe('initialize', () => {
    it('should initialize server', async () => {
      await server.initialize();

      expect(server.isInitialized()).toBe(true);
      expect(server.initializeCalled).toBe(true);
    });

    it('should handle initialization errors', async () => {
      server.shouldFailInitialize = true;

      await expect(server.initialize()).rejects.toThrow('Initialize failed');
      expect(server.isInitialized()).toBe(false);
    });

    it('should allow re-initialization', async () => {
      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      await server.shutdown();
      expect(server.isInitialized()).toBe(false);

      await server.initialize();
      expect(server.isInitialized()).toBe(true);
    });
  });

  describe('onFlagEvaluation', () => {
    beforeEach(async () => {
      await server.initialize();
    });

    it('should handle flag evaluation', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      await server.onFlagEvaluation(evaluation);

      expect(server.evaluations).toHaveLength(1);
      expect(server.evaluations[0]).toEqual(evaluation);
    });

    it('should handle multiple evaluations', async () => {
      const eval1: FlagEvaluation = {
        id: 'eval-1',
        organizationId: 'org-123',
        flagId: 'flag-1',
        flagKey: 'flag-1',
        result: true,
        timestamp: new Date().toISOString(),
      };

      const eval2: FlagEvaluation = {
        id: 'eval-2',
        organizationId: 'org-123',
        flagId: 'flag-2',
        flagKey: 'flag-2',
        result: false,
        timestamp: new Date().toISOString(),
      };

      await server.onFlagEvaluation(eval1);
      await server.onFlagEvaluation(eval2);

      expect(server.evaluations).toHaveLength(2);
      expect(server.evaluations[0]).toEqual(eval1);
      expect(server.evaluations[1]).toEqual(eval2);
    });

    it('should handle evaluation with context', async () => {
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        context: { userId: 'user-789', region: 'us-east' },
        durationMs: 25,
        traceId: 'trace-abc',
        timestamp: new Date().toISOString(),
      };

      await server.onFlagEvaluation(evaluation);

      expect(server.evaluations[0].context).toEqual({
        userId: 'user-789',
        region: 'us-east',
      });
    });

    it('should handle errors in evaluation handler', async () => {
      server.shouldFailOnEvaluation = true;

      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      await expect(server.onFlagEvaluation(evaluation)).rejects.toThrow(
        'onFlagEvaluation failed'
      );
    });
  });

  describe('onFlagError', () => {
    beforeEach(async () => {
      await server.initialize();
    });

    it('should handle flag error', async () => {
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

      await server.onFlagError(error);

      expect(server.errors).toHaveLength(1);
      expect(server.errors[0]).toEqual(error);
    });

    it('should handle error with stack trace', async () => {
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        flagEnabled: true,
        errorType: 'ReferenceError',
        errorMessage: 'x is not defined',
        stackTrace: 'at foo (file.js:1:1)\nat bar (file.js:2:1)',
        context: { browser: 'Chrome' },
        traceId: 'trace-xyz',
        timestamp: new Date().toISOString(),
      };

      await server.onFlagError(error);

      expect(server.errors[0].stackTrace).toBeDefined();
      expect(server.errors[0].context).toEqual({ browser: 'Chrome' });
    });

    it('should handle multiple errors', async () => {
      const error1: FlagError = {
        id: 'error-1',
        organizationId: 'org-123',
        flagId: 'flag-1',
        flagKey: 'flag-1',
        flagEnabled: true,
        errorType: 'Error',
        errorMessage: 'Error 1',
        timestamp: new Date().toISOString(),
      };

      const error2: FlagError = {
        id: 'error-2',
        organizationId: 'org-123',
        flagId: 'flag-2',
        flagKey: 'flag-2',
        flagEnabled: false,
        errorType: 'Error',
        errorMessage: 'Error 2',
        timestamp: new Date().toISOString(),
      };

      await server.onFlagError(error1);
      await server.onFlagError(error2);

      expect(server.errors).toHaveLength(2);
    });

    it('should handle errors in error handler', async () => {
      server.shouldFailOnError = true;

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

      await expect(server.onFlagError(error)).rejects.toThrow('onFlagError failed');
    });
  });

  describe('queryErrors', () => {
    beforeEach(async () => {
      await server.initialize();
    });

    it('should query external errors', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
        flagId: 'flag-456',
      };

      const errors = await server.queryErrors(query);

      expect(errors).toHaveLength(1);
      expect(errors[0].errorType).toBe('TypeError');
    });

    it('should query with time range', async () => {
      const query: ErrorQuery = {
        organizationId: 'org-123',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-12-31'),
      };

      const errors = await server.queryErrors(query);

      expect(errors).toBeDefined();
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should handle query errors', async () => {
      server.shouldFailQueryErrors = true;

      const query: ErrorQuery = {
        organizationId: 'org-123',
      };

      await expect(server.queryErrors(query)).rejects.toThrow('queryErrors failed');
    });
  });

  describe('correlateErrors', () => {
    beforeEach(async () => {
      await server.initialize();
    });

    it('should correlate errors with flag evaluations', async () => {
      const now = new Date();
      const externalErrors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'TypeError',
          errorMessage: 'Test error',
          timestamp: now.toISOString(),
        },
      ];

      const flagEvaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          result: true,
          timestamp: new Date(now.getTime() + 1000).toISOString(), // 1 second later
        },
      ];

      const correlations = await server.correlateErrors(
        externalErrors,
        flagEvaluations
      );

      expect(correlations).toHaveLength(1);
      expect(correlations[0].flagId).toBe('flag-1');
      expect(correlations[0].flagKey).toBe('test-flag');
      expect(correlations[0].externalError.id).toBe('ext-error-1');
    });

    it('should calculate correlation score based on flag results', async () => {
      const now = new Date();
      const externalErrors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: now.toISOString(),
        },
      ];

      const flagEvaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          result: true,
          timestamp: now.toISOString(),
        },
        {
          id: 'eval-2',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          result: true,
          timestamp: now.toISOString(),
        },
        {
          id: 'eval-3',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          result: false,
          timestamp: now.toISOString(),
        },
      ];

      const correlations = await server.correlateErrors(
        externalErrors,
        flagEvaluations
      );

      expect(correlations[0].correlationScore).toBeCloseTo(2 / 3, 2);
    });

    it('should set confidence level based on correlation score', async () => {
      const now = new Date();
      const externalErrors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: now.toISOString(),
        },
        {
          id: 'ext-error-2',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: now.toISOString(),
        },
      ];

      const highConfidenceEvals: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-high',
          flagKey: 'high-conf-flag',
          result: true,
          timestamp: now.toISOString(),
        },
        {
          id: 'eval-2',
          organizationId: 'org-123',
          flagId: 'flag-high',
          flagKey: 'high-conf-flag',
          result: true,
          timestamp: now.toISOString(),
        },
      ];

      const lowConfidenceEvals: FlagEvaluation[] = [
        {
          id: 'eval-3',
          organizationId: 'org-123',
          flagId: 'flag-low',
          flagKey: 'low-conf-flag',
          result: true,
          timestamp: now.toISOString(),
        },
        {
          id: 'eval-4',
          organizationId: 'org-123',
          flagId: 'flag-low',
          flagKey: 'low-conf-flag',
          result: false,
          timestamp: now.toISOString(),
        },
        {
          id: 'eval-5',
          organizationId: 'org-123',
          flagId: 'flag-low',
          flagKey: 'low-conf-flag',
          result: false,
          timestamp: now.toISOString(),
        },
      ];

      const allEvals = [...highConfidenceEvals, ...lowConfidenceEvals];
      const correlations = await server.correlateErrors(externalErrors, allEvals);

      const highConfCorrelation = correlations.find(
        (c) => c.flagId === 'flag-high'
      );
      const lowConfCorrelation = correlations.find((c) => c.flagId === 'flag-low');

      expect(highConfCorrelation?.confidence).toBe('high');
      expect(lowConfCorrelation?.confidence).toBe('low');
    });

    it('should not correlate errors outside time window', async () => {
      const now = new Date();
      const externalErrors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: now.toISOString(),
        },
      ];

      const flagEvaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          result: true,
          timestamp: new Date(now.getTime() + 120000).toISOString(), // 2 minutes later
        },
      ];

      const correlations = await server.correlateErrors(
        externalErrors,
        flagEvaluations
      );

      expect(correlations).toHaveLength(0);
    });

    it('should handle empty inputs', async () => {
      const correlations1 = await server.correlateErrors([], []);
      expect(correlations1).toHaveLength(0);

      const correlations2 = await server.correlateErrors(
        [
          {
            id: 'error-1',
            errorType: 'Error',
            errorMessage: 'Test',
            timestamp: new Date().toISOString(),
          },
        ],
        []
      );
      expect(correlations2).toHaveLength(0);

      const correlations3 = await server.correlateErrors([], [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'test-flag',
          result: true,
          timestamp: new Date().toISOString(),
        },
      ]);
      expect(correlations3).toHaveLength(0);
    });
  });

  describe('healthCheck', () => {
    it('should return unhealthy when not initialized', async () => {
      const health = await server.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toBe('Server not initialized');
      expect(health.lastCheck).toBeDefined();
    });

    it('should return healthy when initialized', async () => {
      await server.initialize();
      const health = await server.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toBe('Server initialized');
      expect(health.lastCheck).toBeDefined();
    });

    it('should include ISO timestamp', async () => {
      const health = await server.healthCheck();
      const timestamp = new Date(health.lastCheck);

      expect(timestamp.toISOString()).toBe(health.lastCheck);
    });
  });

  describe('shutdown', () => {
    it('should shutdown initialized server', async () => {
      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      await server.shutdown();

      expect(server.isInitialized()).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      expect(server.isInitialized()).toBe(false);

      await server.shutdown();

      expect(server.isInitialized()).toBe(false);
    });

    it('should allow re-initialization after shutdown', async () => {
      await server.initialize();
      await server.shutdown();
      await server.initialize();

      expect(server.isInitialized()).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return config copy', () => {
      const config = server.getConfig();

      expect(config).toEqual(testConfig);
      expect(config).not.toBe(testConfig); // Should be a copy
    });

    it('should not allow mutation of internal config', () => {
      const config = server.getConfig();
      config.enabled = false;

      const originalConfig = server.getConfig();
      expect(originalConfig.enabled).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', async () => {
      const newConfig = {
        enabled: false,
        config: { apiKey: 'new-key' },
      };

      await server.updateConfig(newConfig);

      const config = server.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.config.apiKey).toBe('new-key');
      expect(config.organizationId).toBe('org-123'); // Unchanged
    });

    it('should re-initialize if already initialized', async () => {
      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      const originalInitializeCount = server.initializeCalled;
      await server.updateConfig({ enabled: false });

      expect(server.isInitialized()).toBe(true);
    });

    it('should not re-initialize if not initialized', async () => {
      expect(server.isInitialized()).toBe(false);

      await server.updateConfig({ enabled: false });

      expect(server.isInitialized()).toBe(false);
      expect(server.initializeCalled).toBe(false);
    });

    it('should handle partial updates', async () => {
      const originalConfig = server.getConfig();

      await server.updateConfig({ enabled: false });

      const updatedConfig = server.getConfig();
      expect(updatedConfig.enabled).toBe(false);
      expect(updatedConfig.organizationId).toBe(originalConfig.organizationId);
      expect(updatedConfig.integrationId).toBe(originalConfig.integrationId);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(server.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await server.initialize();
      expect(server.isInitialized()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      await server.initialize();
      await server.shutdown();
      expect(server.isInitialized()).toBe(false);
    });
  });
});
