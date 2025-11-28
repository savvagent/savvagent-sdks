/**
 * Integration tests for MCP SDK
 * Tests the complete flow of webhook handling, server processing, and client communication
 */

import axios from 'axios';
import { MCPClient } from '../src/client';
import { MCPServer } from '../src/server';
import { MCPWebhookHandler } from '../src/webhook';
import {
  MCPConfig,
  FlagEvaluation,
  FlagError,
  ErrorQuery,
  ExternalError,
  MCPWebhookPayload,
} from '../src/types';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test server implementation
class IntegrationTestServer extends MCPServer {
  public evaluations: FlagEvaluation[] = [];
  public errors: FlagError[] = [];

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async onFlagEvaluation(evaluation: FlagEvaluation): Promise<void> {
    this.evaluations.push(evaluation);
  }

  async onFlagError(error: FlagError): Promise<void> {
    this.errors.push(error);
  }

  async queryErrors(query: ErrorQuery): Promise<ExternalError[]> {
    return [
      {
        id: 'ext-error-1',
        errorType: 'TypeError',
        errorMessage: 'Integration test error',
        timestamp: new Date().toISOString(),
        count: 5,
        tags: { source: 'integration-test' },
      },
    ];
  }
}

describe('MCP SDK Integration Tests', () => {
  let client: MCPClient;
  let server: IntegrationTestServer;
  let webhookHandler: MCPWebhookHandler;
  let mockAxiosInstance: any;

  const clientConfig = {
    apiUrl: 'https://api.savvagent.com',
    apiKey: 'test-api-key',
    organizationId: 'org-123',
  };

  const serverConfig: MCPConfig = {
    organizationId: 'org-123',
    integrationId: 'integration-456',
    serverType: 'test-integration',
    config: {},
    enabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup axios mock
    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ data: {} }),
      get: jest.fn().mockResolvedValue({ data: [] }),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    // Create instances
    client = new MCPClient(clientConfig);
    server = new IntegrationTestServer(serverConfig);
    webhookHandler = new MCPWebhookHandler();
  });

  describe('Complete webhook flow', () => {
    it('should handle webhook -> server -> client flow', async () => {
      // Initialize and register server
      await server.initialize();
      webhookHandler.registerServer(serverConfig.integrationId, server);

      // Simulate webhook from Savvagent
      const webhookPayload: MCPWebhookPayload = {
        eventType: 'flag_evaluation',
        data: {
          id: 'eval-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: true,
          context: { userId: 'user-789' },
          timestamp: new Date().toISOString(),
        },
        integrationId: serverConfig.integrationId,
        timestamp: new Date().toISOString(),
      };

      // Handle webhook
      await webhookHandler.handleWebhook(webhookPayload);

      // Verify server received it
      expect(server.evaluations).toHaveLength(1);
      expect(server.evaluations[0].flagKey).toBe('test-flag');

      // Server sends to client
      await client.sendEvaluation(server.evaluations[0]);

      // Verify client called API
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/evaluations',
        expect.objectContaining({
          flagKey: 'test-flag',
        })
      );
    });

    it('should handle error webhook flow', async () => {
      await server.initialize();
      webhookHandler.registerServer(serverConfig.integrationId, server);

      const errorPayload: MCPWebhookPayload = {
        eventType: 'flag_error',
        data: {
          id: 'error-123',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'error-flag',
          flagEnabled: true,
          errorType: 'TypeError',
          errorMessage: 'Cannot read property',
          stackTrace: 'at foo()',
          timestamp: new Date().toISOString(),
        },
        integrationId: serverConfig.integrationId,
        timestamp: new Date().toISOString(),
      };

      await webhookHandler.handleWebhook(errorPayload);

      expect(server.errors).toHaveLength(1);
      expect(server.errors[0].errorType).toBe('TypeError');

      await client.sendError(server.errors[0]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/errors',
        expect.objectContaining({
          errorType: 'TypeError',
        })
      );
    });
  });

  describe('Error correlation flow', () => {
    it('should query errors and correlate with evaluations', async () => {
      await server.initialize();

      // Query external errors
      const externalErrors = await server.queryErrors({
        organizationId: 'org-123',
        flagId: 'flag-456',
      });

      expect(externalErrors).toHaveLength(1);

      // Get flag evaluations from client
      const mockEvaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: true,
          timestamp: new Date().toISOString(),
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockEvaluations });
      const evaluations = await client.queryEvaluations({
        organizationId: 'org-123',
        flagId: 'flag-456',
      });

      // Correlate
      const correlations = await server.correlateErrors(externalErrors, evaluations);

      expect(correlations.length).toBeGreaterThanOrEqual(0);
    });

    it('should send correlation results back to API', async () => {
      await server.initialize();

      const externalErrors: ExternalError[] = [
        {
          id: 'ext-error-1',
          errorType: 'Error',
          errorMessage: 'Test',
          timestamp: new Date().toISOString(),
        },
      ];

      const flagEvaluations: FlagEvaluation[] = [
        {
          id: 'eval-1',
          organizationId: 'org-123',
          flagId: 'flag-456',
          flagKey: 'test-flag',
          result: true,
          timestamp: new Date().toISOString(),
        },
      ];

      const correlations = await server.correlateErrors(
        externalErrors,
        flagEvaluations
      );

      // Send external errors to API
      await client.sendExternalErrors(externalErrors);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/mcp/external-errors',
        expect.objectContaining({
          organizationId: clientConfig.organizationId,
          errors: externalErrors,
        })
      );

      // Get correlations from API
      mockAxiosInstance.get.mockResolvedValueOnce({ data: correlations });
      const apiCorrelations = await client.getCorrelations('flag-456');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/mcp/correlations/flag-456'
      );
    });
  });

  describe('Multiple server integration', () => {
    it('should handle multiple servers with different integrations', async () => {
      const server1 = new IntegrationTestServer(serverConfig);
      const server2 = new IntegrationTestServer({
        ...serverConfig,
        integrationId: 'integration-789',
      });

      await server1.initialize();
      await server2.initialize();

      webhookHandler.registerServer('integration-456', server1);
      webhookHandler.registerServer('integration-789', server2);

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
          result: false,
          timestamp: new Date().toISOString(),
        },
        integrationId: 'integration-789',
        timestamp: new Date().toISOString(),
      };

      await webhookHandler.handleWebhook(payload1);
      await webhookHandler.handleWebhook(payload2);

      expect(server1.evaluations).toHaveLength(1);
      expect(server1.evaluations[0].flagKey).toBe('flag-1');

      expect(server2.evaluations).toHaveLength(1);
      expect(server2.evaluations[0].flagKey).toBe('flag-2');
    });
  });

  describe('Server lifecycle management', () => {
    it('should handle server initialization and shutdown', async () => {
      expect(server.isInitialized()).toBe(false);

      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      const health = await server.healthCheck();
      expect(health.healthy).toBe(true);

      await server.shutdown();
      expect(server.isInitialized()).toBe(false);

      const unhealthyStatus = await server.healthCheck();
      expect(unhealthyStatus.healthy).toBe(false);
    });

    it('should handle config updates', async () => {
      await server.initialize();

      const oldConfig = server.getConfig();
      expect(oldConfig.enabled).toBe(true);

      await server.updateConfig({ enabled: false });

      const newConfig = server.getConfig();
      expect(newConfig.enabled).toBe(false);
      expect(server.isInitialized()).toBe(true); // Should re-initialize
    });
  });

  describe('Error handling across components', () => {
    it('should propagate errors through the stack', async () => {
      await server.initialize();
      webhookHandler.registerServer(serverConfig.integrationId, server);

      // Invalid webhook (unknown event type)
      const invalidPayload: any = {
        eventType: 'invalid_type',
        data: {},
        integrationId: serverConfig.integrationId,
        timestamp: new Date().toISOString(),
      };

      await expect(webhookHandler.handleWebhook(invalidPayload)).rejects.toThrow(
        'Unknown event type'
      );
    });

    it('should handle client API errors', async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 500 },
        message: 'Internal Server Error',
      });

      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'test-flag',
        result: true,
        timestamp: new Date().toISOString(),
      };

      await expect(client.sendEvaluation(evaluation)).rejects.toMatchObject({
        response: { status: 500 },
      });
    });

    it('should handle uninitialized server', async () => {
      // Don't initialize server
      webhookHandler.registerServer(serverConfig.integrationId, server);

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
        integrationId: serverConfig.integrationId,
        timestamp: new Date().toISOString(),
      };

      await expect(webhookHandler.handleWebhook(payload)).rejects.toThrow(
        'Server not initialized'
      );
    });
  });

  describe('Real-world scenario simulation', () => {
    it('should handle a complete observability workflow', async () => {
      // Step 1: Initialize system
      await server.initialize();
      webhookHandler.registerServer(serverConfig.integrationId, server);

      // Step 2: Receive flag evaluation webhook
      const evaluation: FlagEvaluation = {
        id: 'eval-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'new-feature',
        result: true,
        context: { userId: 'user-123', environment: 'production' },
        durationMs: 12,
        timestamp: new Date().toISOString(),
      };

      await webhookHandler.handleWebhook({
        eventType: 'flag_evaluation',
        data: evaluation,
        integrationId: serverConfig.integrationId,
        timestamp: new Date().toISOString(),
      });

      // Step 3: Error occurs
      const error: FlagError = {
        id: 'error-123',
        organizationId: 'org-123',
        flagId: 'flag-456',
        flagKey: 'new-feature',
        flagEnabled: true,
        errorType: 'ReferenceError',
        errorMessage: 'feature is not defined',
        stackTrace: 'at newFeature()',
        context: { userId: 'user-123' },
        timestamp: new Date().toISOString(),
      };

      await webhookHandler.handleWebhook({
        eventType: 'flag_error',
        data: error,
        integrationId: serverConfig.integrationId,
        timestamp: new Date().toISOString(),
      });

      // Step 4: Query external errors
      const externalErrors = await server.queryErrors({
        organizationId: 'org-123',
        flagId: 'flag-456',
      });

      // Step 5: Correlate errors
      const correlations = await server.correlateErrors(
        externalErrors,
        server.evaluations
      );

      // Step 6: Send to API
      await client.sendExternalErrors(externalErrors);

      // Verify complete flow
      expect(server.evaluations).toHaveLength(1);
      expect(server.errors).toHaveLength(1);
      expect(externalErrors.length).toBeGreaterThan(0);
      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });
  });
});
