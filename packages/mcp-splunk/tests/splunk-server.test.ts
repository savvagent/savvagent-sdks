/**
 * Tests for Splunk MCP Server
 */

import { SplunkMCPServer, SplunkConfig } from '../src/splunk-server';
import { JsonRpcRequest } from '@savvagent/mcp-sdk';

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
}));

describe('SplunkMCPServer', () => {
  let server: SplunkMCPServer;
  const mockConfig: SplunkConfig = {
    host: 'https://splunk.example.com:8089',
    token: 'test-token',
    defaultIndex: 'main',
  };

  beforeEach(() => {
    server = new SplunkMCPServer(
      { name: 'test-splunk-server', version: '1.0.0' },
      mockConfig
    );
  });

  describe('constructor', () => {
    it('should create server with config', () => {
      expect(server.getConfig().name).toBe('test-splunk-server');
    });

    it('should register all Splunk tools', () => {
      const tools = server.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('search_logs');
      expect(toolNames).toContain('get_errors');
      expect(toolNames).toContain('get_log_patterns');
      expect(toolNames).toContain('get_anomalies');
      expect(toolNames).toContain('get_saved_searches');
      expect(toolNames).toContain('run_saved_search');
      expect(toolNames).toContain('get_alerts');
      expect(toolNames).toContain('get_service_health');
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
      expect((response as any).result.tools.length).toBe(8);
    });
  });

  describe('tool schemas', () => {
    it('should have correct schemas', () => {
      const tools = server.getTools();

      const searchLogs = tools.find((t) => t.name === 'search_logs');
      expect(searchLogs?.inputSchema.required).toContain('query');

      const runSavedSearch = tools.find((t) => t.name === 'run_saved_search');
      expect(runSavedSearch?.inputSchema.required).toContain('name');
    });
  });
});

describe('SplunkMCPServer exports', () => {
  it('should export SplunkMCPServer', () => {
    expect(SplunkMCPServer).toBeDefined();
  });
});
