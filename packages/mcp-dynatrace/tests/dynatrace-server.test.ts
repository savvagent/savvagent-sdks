/**
 * Tests for Dynatrace MCP Server
 */

import { DynatraceMCPServer, DynatraceConfig } from '../src/dynatrace-server';
import { JsonRpcRequest } from '@savvagent/mcp-sdk';

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
}));

describe('DynatraceMCPServer', () => {
  let server: DynatraceMCPServer;
  const mockConfig: DynatraceConfig = {
    environmentUrl: 'https://abc12345.live.dynatrace.com',
    apiToken: 'test-token',
    managementZone: 'production',
  };

  beforeEach(() => {
    server = new DynatraceMCPServer(
      { name: 'test-dynatrace-server', version: '1.0.0' },
      mockConfig
    );
  });

  describe('constructor', () => {
    it('should create server with config', () => {
      expect(server.getConfig().name).toBe('test-dynatrace-server');
    });

    it('should register all Dynatrace tools', () => {
      const tools = server.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('get_problems');
      expect(toolNames).toContain('get_problem_details');
      expect(toolNames).toContain('get_services');
      expect(toolNames).toContain('get_service_metrics');
      expect(toolNames).toContain('get_hosts');
      expect(toolNames).toContain('get_logs');
      expect(toolNames).toContain('get_synthetic_monitors');
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
      expect((response as any).result.tools.length).toBe(9);
    });
  });
});

describe('DynatraceMCPServer exports', () => {
  it('should export DynatraceMCPServer', () => {
    expect(DynatraceMCPServer).toBeDefined();
  });
});
