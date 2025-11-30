/**
 * Tests for Datadog MCP Server
 */

import { DatadogMCPServer, DatadogConfig } from '../src/datadog-server';
import { JsonRpcRequest } from '@savvagent/mcp-sdk';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
}));

describe('DatadogMCPServer', () => {
  let server: DatadogMCPServer;
  const mockConfig: DatadogConfig = {
    apiKey: 'test-api-key',
    appKey: 'test-app-key',
    site: 'datadoghq.com',
    environment: 'production',
    service: 'test-service',
  };

  beforeEach(() => {
    server = new DatadogMCPServer(
      { name: 'test-datadog-server', version: '1.0.0' },
      mockConfig
    );
  });

  describe('constructor', () => {
    it('should create server with config', () => {
      expect(server.getConfig().name).toBe('test-datadog-server');
      expect(server.getConfig().version).toBe('1.0.0');
    });

    it('should register all Datadog tools', () => {
      const tools = server.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('get_errors');
      expect(toolNames).toContain('get_metrics');
      expect(toolNames).toContain('get_traces');
      expect(toolNames).toContain('get_logs');
      expect(toolNames).toContain('get_monitors');
      expect(toolNames).toContain('get_service_health');
      expect(toolNames).toContain('get_events');
    });
  });

  describe('tools/list', () => {
    it('should return all registered tools', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.tools.length).toBe(7);
    });

    it('should have correct tool schemas', async () => {
      const tools = server.getTools();

      // Check get_errors tool
      const getErrors = tools.find((t) => t.name === 'get_errors');
      expect(getErrors).toBeDefined();
      expect(getErrors?.inputSchema.properties).toHaveProperty('time_range');
      expect(getErrors?.inputSchema.properties).toHaveProperty('service');
      expect(getErrors?.inputSchema.properties).toHaveProperty('environment');
      expect(getErrors?.inputSchema.properties).toHaveProperty('limit');

      // Check get_metrics tool
      const getMetrics = tools.find((t) => t.name === 'get_metrics');
      expect(getMetrics).toBeDefined();
      expect(getMetrics?.inputSchema.required).toContain('query');

      // Check get_traces tool
      const getTraces = tools.find((t) => t.name === 'get_traces');
      expect(getTraces).toBeDefined();
      expect(getTraces?.inputSchema.properties).toHaveProperty('min_duration_ms');
      expect(getTraces?.inputSchema.properties).toHaveProperty('status');

      // Check get_logs tool
      const getLogs = tools.find((t) => t.name === 'get_logs');
      expect(getLogs).toBeDefined();
      expect(getLogs?.inputSchema.required).toContain('query');

      // Check get_monitors tool
      const getMonitors = tools.find((t) => t.name === 'get_monitors');
      expect(getMonitors).toBeDefined();
      expect(getMonitors?.inputSchema.properties).toHaveProperty('status');

      // Check get_service_health tool
      const getServiceHealth = tools.find((t) => t.name === 'get_service_health');
      expect(getServiceHealth).toBeDefined();
      expect(getServiceHealth?.inputSchema.properties).toHaveProperty('service');

      // Check get_events tool
      const getEvents = tools.find((t) => t.name === 'get_events');
      expect(getEvents).toBeDefined();
      expect(getEvents?.inputSchema.properties).toHaveProperty('priority');
    });
  });

  describe('tool descriptions', () => {
    it('should have meaningful descriptions for all tools', () => {
      const tools = server.getTools();

      for (const tool of tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });
  });
});

describe('DatadogMCPServer exports', () => {
  it('should export DatadogMCPServer', () => {
    expect(DatadogMCPServer).toBeDefined();
  });
});
