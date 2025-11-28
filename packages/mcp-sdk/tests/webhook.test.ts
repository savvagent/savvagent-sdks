/**
 * Unit tests for MCPWebhookHandler
 */

import { MCPWebhookHandler } from '../src/webhook';
import {
  MCPWebhookPayload,
  FlagEvaluation,
  FlagError,
  MCPConfig,
  ErrorQuery,
  ExternalError,
} from '../src/types';
import { MCPServer } from '../src/server';

// Mock MCP Server implementation
class MockMCPServer extends MCPServer {
  public onFlagEvaluationCalled = false;
  public onFlagErrorCalled = false;
  public lastEvaluation?: FlagEvaluation;
  public lastError?: FlagError;
  public shouldThrowOnEvaluation = false;
  public shouldThrowOnError = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async onFlagEvaluation(evaluation: FlagEvaluation): Promise<void> {
    if (this.shouldThrowOnEvaluation) {
      throw new Error('onFlagEvaluation error');
    }
    this.onFlagEvaluationCalled = true;
    this.lastEvaluation = evaluation;
  }

  async onFlagError(error: FlagError): Promise<void> {
    if (this.shouldThrowOnError) {
      throw new Error('onFlagError error');
    }
    this.onFlagErrorCalled = true;
    this.lastError = error;
  }

  async queryErrors(query: ErrorQuery): Promise<ExternalError[]> {
    return [];
  }
}

describe('MCPWebhookHandler', () => {
  let handler: MCPWebhookHandler;
  let mockServer: MockMCPServer;

  const testConfig: MCPConfig = {
    organizationId: 'org-123',
    integrationId: 'integration-456',
    serverType: 'test-server',
    config: {},
    enabled: true,
  };

  beforeEach(() => {
    handler = new MCPWebhookHandler();
    mockServer = new MockMCPServer(testConfig);
  });

  describe('registerServer', () => {
    it('should register a server', () => {
      handler.registerServer('integration-456', mockServer);

      const registered = handler.getRegisteredServers();
      expect(registered).toContain('integration-456');
    });

    it('should register multiple servers', () => {
      const server1 = new MockMCPServer(testConfig);
      const server2 = new MockMCPServer({
        ...testConfig,
        integrationId: 'integration-789',
      });

      handler.registerServer('integration-456', server1);
      handler.registerServer('integration-789', server2);

      const registered = handler.getRegisteredServers();
      expect(registered).toHaveLength(2);
      expect(registered).toContain('integration-456');
      expect(registered).toContain('integration-789');
    });

    it('should allow re-registering same integration', () => {
      handler.registerServer('integration-456', mockServer);

      const newServer = new MockMCPServer(testConfig);
      handler.registerServer('integration-456', newServer);

      const registered = handler.getRegisteredServers();
      expect(registered).toHaveLength(1);
    });
  });

  describe('unregisterServer', () => {
    beforeEach(() => {
      handler.registerServer('integration-456', mockServer);
    });

    it('should unregister a server', () => {
      handler.unregisterServer('integration-456');

      const registered = handler.getRegisteredServers();
      expect(registered).not.toContain('integration-456');
      expect(registered).toHaveLength(0);
    });

    it('should handle unregistering non-existent server', () => {
      handler.unregisterServer('non-existent');

      const registered = handler.getRegisteredServers();
      expect(registered).toContain('integration-456');
    });

    it('should allow re-registering after unregistering', () => {
      handler.unregisterServer('integration-456');
      handler.registerServer('integration-456', mockServer);

      const registered = handler.getRegisteredServers();
      expect(registered).toContain('integration-456');
    });
  });

  describe('handleWebhook', () => {
    beforeEach(async () => {
      handler.registerServer('integration-456', mockServer);
      await mockServer.initialize();
    });

    describe('flag_evaluation events', () => {
      it('should handle flag evaluation webhook', async () => {
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

        await handler.handleWebhook(payload);

        expect(mockServer.onFlagEvaluationCalled).toBe(true);
        expect(mockServer.lastEvaluation).toEqual(payload.data);
      });

      it('should handle evaluation with full context', async () => {
        const evaluation: FlagEvaluation = {
          id: 'eval-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: false,
          context: { userId: 'user-789', environment: 'production' },
          durationMs: 15,
          traceId: 'trace-abc',
          timestamp: new Date().toISOString(),
        };

        const payload: MCPWebhookPayload = {
          eventType: 'flag_evaluation',
          data: evaluation,
          integrationId: 'integration-456',
          timestamp: new Date().toISOString(),
        };

        await handler.handleWebhook(payload);

        expect(mockServer.lastEvaluation?.context).toEqual(evaluation.context);
        expect(mockServer.lastEvaluation?.durationMs).toBe(15);
        expect(mockServer.lastEvaluation?.traceId).toBe('trace-abc');
      });

      it('should propagate errors from server handler', async () => {
        mockServer.shouldThrowOnEvaluation = true;

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

        await expect(handler.handleWebhook(payload)).rejects.toThrow(
          'onFlagEvaluation error'
        );
      });
    });

    describe('flag_error events', () => {
      it('should handle flag error webhook', async () => {
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

        const payload: MCPWebhookPayload = {
          eventType: 'flag_error',
          data: error,
          integrationId: 'integration-456',
          timestamp: new Date().toISOString(),
        };

        await handler.handleWebhook(payload);

        expect(mockServer.onFlagErrorCalled).toBe(true);
        expect(mockServer.lastError).toEqual(error);
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
          stackTrace:
            'ReferenceError: x is not defined\n    at foo (index.js:10:5)',
          context: { route: '/api/users' },
          traceId: 'trace-xyz',
          timestamp: new Date().toISOString(),
        };

        const payload: MCPWebhookPayload = {
          eventType: 'flag_error',
          data: error,
          integrationId: 'integration-456',
          timestamp: new Date().toISOString(),
        };

        await handler.handleWebhook(payload);

        expect(mockServer.lastError?.stackTrace).toBeDefined();
        expect(mockServer.lastError?.context).toEqual({ route: '/api/users' });
      });

      it('should propagate errors from error handler', async () => {
        mockServer.shouldThrowOnError = true;

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

        await expect(handler.handleWebhook(payload)).rejects.toThrow(
          'onFlagError error'
        );
      });
    });

    describe('error handling', () => {
      it('should throw error for unregistered integration', async () => {
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
          integrationId: 'non-existent',
          timestamp: new Date().toISOString(),
        };

        await expect(handler.handleWebhook(payload)).rejects.toThrow(
          'No server registered for integration: non-existent'
        );
      });

      it('should throw error for uninitialized server', async () => {
        const uninitializedServer = new MockMCPServer(testConfig);
        handler.registerServer('integration-789', uninitializedServer);

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
          integrationId: 'integration-789',
          timestamp: new Date().toISOString(),
        };

        await expect(handler.handleWebhook(payload)).rejects.toThrow(
          'Server not initialized for integration: integration-789'
        );
      });

      it('should throw error for unknown event type', async () => {
        const payload: any = {
          eventType: 'unknown_event',
          data: {},
          integrationId: 'integration-456',
          timestamp: new Date().toISOString(),
        };

        await expect(handler.handleWebhook(payload)).rejects.toThrow(
          'Unknown event type: unknown_event'
        );
      });
    });
  });

  describe('validateSignature', () => {
    it('should validate signature', () => {
      const payload = '{"eventType":"flag_evaluation"}';
      const signature = 'sha256=abc123';
      const secret = 'webhook-secret';

      const isValid = handler.validateSignature(payload, signature, secret);

      // Basic implementation just checks signature length
      expect(isValid).toBe(true);
    });

    it('should reject empty signature', () => {
      const payload = '{"eventType":"flag_evaluation"}';
      const signature = '';
      const secret = 'webhook-secret';

      const isValid = handler.validateSignature(payload, signature, secret);

      expect(isValid).toBe(false);
    });

    it('should handle different signature formats', () => {
      const payload = '{"eventType":"flag_evaluation"}';
      const secret = 'webhook-secret';

      expect(handler.validateSignature(payload, 'sha256=hash', secret)).toBe(true);
      expect(handler.validateSignature(payload, 'v1,t=timestamp,s=sig', secret)).toBe(
        true
      );
    });
  });

  describe('getRegisteredServers', () => {
    it('should return empty array initially', () => {
      const registered = handler.getRegisteredServers();
      expect(registered).toEqual([]);
    });

    it('should return all registered integration IDs', () => {
      const server1 = new MockMCPServer(testConfig);
      const server2 = new MockMCPServer({
        ...testConfig,
        integrationId: 'integration-789',
      });
      const server3 = new MockMCPServer({
        ...testConfig,
        integrationId: 'integration-abc',
      });

      handler.registerServer('integration-456', server1);
      handler.registerServer('integration-789', server2);
      handler.registerServer('integration-abc', server3);

      const registered = handler.getRegisteredServers();
      expect(registered).toHaveLength(3);
      expect(registered).toContain('integration-456');
      expect(registered).toContain('integration-789');
      expect(registered).toContain('integration-abc');
    });

    it('should update after registration and unregistration', () => {
      handler.registerServer('integration-456', mockServer);
      expect(handler.getRegisteredServers()).toHaveLength(1);

      const server2 = new MockMCPServer({
        ...testConfig,
        integrationId: 'integration-789',
      });
      handler.registerServer('integration-789', server2);
      expect(handler.getRegisteredServers()).toHaveLength(2);

      handler.unregisterServer('integration-456');
      expect(handler.getRegisteredServers()).toHaveLength(1);
      expect(handler.getRegisteredServers()).toContain('integration-789');
    });
  });

  describe('multiple webhooks', () => {
    beforeEach(async () => {
      handler.registerServer('integration-456', mockServer);
      await mockServer.initialize();
    });

    it('should handle multiple webhooks in sequence', async () => {
      const payload1: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'flag-1',
          result: true,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      const payload2: MCPWebhookPayload = {
        eventType: 'flag_error',
        data: {
          id: 'error-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'flag-1',
          flagEnabled: true,
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      await handler.handleWebhook(payload1);
      await handler.handleWebhook(payload2);

      expect(mockServer.onFlagEvaluationCalled).toBe(true);
      expect(mockServer.onFlagErrorCalled).toBe(true);
    });

    it('should route webhooks to correct servers', async () => {
      const server2 = new MockMCPServer({
        ...testConfig,
        integrationId: 'integration-789',
      });
      await server2.initialize();
      handler.registerServer('integration-789', server2);

      const payload1: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-1',
          flagKey: 'flag-1',
          result: true,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      const payload2: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-2',
          organizationId: 'org-123',
          flagId: 'flag-2',
          flagKey: 'flag-2',
          result: true,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-789',
        timestamp: new Date().toISOString(),
      };

      await handler.handleWebhook(payload1);
      await handler.handleWebhook(payload2);

      expect(mockServer.onFlagEvaluationCalled).toBe(true);
      expect(mockServer.lastEvaluation?.id).toBe('eval-1');

      expect(server2.onFlagEvaluationCalled).toBe(true);
      expect(server2.lastEvaluation?.id).toBe('eval-2');
    });
  });

  describe('edge cases', () => {
    it('should handle webhook with minimal data', async () => {
      handler.registerServer('integration-456', mockServer);
      await mockServer.initialize();

      const payload: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: false,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      await handler.handleWebhook(payload);

      expect(mockServer.onFlagEvaluationCalled).toBe(true);
    });

    it('should handle webhook with null context', async () => {
      handler.registerServer('integration-456', mockServer);
      await mockServer.initialize();

      const payload: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: true,
          context: undefined,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      };

      await handler.handleWebhook(payload);

      expect(mockServer.onFlagEvaluationCalled).toBe(true);
    });

    it('should handle concurrent webhooks', async () => {
      handler.registerServer('integration-456', mockServer);
      await mockServer.initialize();

      const payloads: MCPWebhookPayload[] = Array.from({ length: 10 }, (_, i) => ({
        eventType: 'flag_evaluation' as const,
        data: {
          id: `eval-${i}`,
          organizationId: 'org-123',
          flagId: `flag-${i}`,
          flagKey: `flag-${i}`,
          result: true,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-456',
        timestamp: new Date().toISOString(),
      }));

      await Promise.all(payloads.map((p) => handler.handleWebhook(p)));

      expect(mockServer.onFlagEvaluationCalled).toBe(true);
    });
  });
});
