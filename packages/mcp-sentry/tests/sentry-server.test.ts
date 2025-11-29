/**
 * Unit tests for SentryMCPServer
 * @jest-environment node
 */

import { SentryMCPServer, SentryConfig } from '../src/sentry-server';
import axios from 'axios';
import { MCPServerConfig, JsonRpcRequest } from '@savvagent/mcp-sdk';

// Mock axios
jest.mock('axios');

describe('SentryMCPServer', () => {
  let server: SentryMCPServer;
  let mockSentryConfig: SentryConfig;
  let mockServerConfig: MCPServerConfig;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSentryConfig = {
      authToken: 'test-auth-token',
      organization: 'test-org',
      project: 'test-project',
      environment: 'test',
    };

    mockServerConfig = {
      name: 'test-sentry-server',
      version: '1.0.0',
    };

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    server = new SentryMCPServer(mockServerConfig, mockSentryConfig);
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      expect(server).toBeInstanceOf(SentryMCPServer);
      expect(server.isInitialized()).toBe(false);
    });

    it('should register Sentry tools', () => {
      const tools = server.getTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('get_errors');
      expect(tools.map((t) => t.name)).toContain('get_error_details');
      expect(tools.map((t) => t.name)).toContain('search_errors');
      expect(tools.map((t) => t.name)).toContain('get_service_health');
    });
  });

  describe('initialize()', () => {
    it('should create axios client with correct config', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      await server.initialize();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://sentry.io/api/0',
        headers: {
          Authorization: `Bearer ${mockSentryConfig.authToken}`,
          'Content-Type': 'application/json',
        },
      });
    });

    it('should verify Sentry connection', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      await server.initialize();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/organizations/test-org/');
    });

    it('should set initialized flag to true', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      expect(server.isInitialized()).toBe(false);
      await server.initialize();
      expect(server.isInitialized()).toBe(true);
    });

    it('should throw error if Sentry connection fails', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection failed'));

      await expect(server.initialize()).rejects.toThrow('Failed to connect to Sentry');
    });
  });

  describe('tools/list', () => {
    it('should return list of available tools', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.tools).toBeInstanceOf(Array);
      expect((response as any).result.tools.length).toBeGreaterThan(0);
    });

    it('should include get_errors tool with correct schema', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      };

      const response = await server.handleRequest(request);
      const getErrorsTool = (response as any).result.tools.find(
        (t: any) => t.name === 'get_errors'
      );

      expect(getErrorsTool).toBeDefined();
      expect(getErrorsTool.description).toContain('error');
      expect(getErrorsTool.inputSchema.properties).toHaveProperty('time_range');
    });
  });

  describe('tools/call - get_errors', () => {
    const mockIssues = [
      {
        id: 'issue-1',
        shortId: 'TEST-1',
        title: 'TypeError: Cannot read property',
        culprit: 'test.js',
        count: 5,
        userCount: 3,
        firstSeen: '2025-01-01T00:00:00Z',
        lastSeen: '2025-01-15T10:00:00Z',
        level: 'error',
        status: 'unresolved',
        isUnhandled: true,
        permalink: 'https://sentry.io/issues/1',
        metadata: {
          type: 'TypeError',
          value: 'Cannot read property of undefined',
          filename: 'test.js',
          function: 'handleClick',
        },
      },
    ];

    beforeEach(async () => {
      mockAxiosInstance.get.mockImplementation((url: string) => {
        if (url.includes('/organizations/')) {
          if (url.includes('/issues/')) {
            return Promise.resolve({ data: mockIssues });
          }
          return Promise.resolve({ data: {} });
        }
        return Promise.resolve({ data: {} });
      });
      await server.initialize();
    });

    it('should call get_errors tool successfully', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_errors',
          arguments: { time_range: '24h' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(false);

      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.errors).toBeInstanceOf(Array);
      expect(content.meta).toBeDefined();
    });

    it('should include error metadata in response', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_errors',
          arguments: { time_range: '24h' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);
      const content = JSON.parse((response as any).result.content[0].text);

      expect(content.errors[0]).toHaveProperty('id');
      expect(content.errors[0]).toHaveProperty('title');
      expect(content.errors[0]).toHaveProperty('count');
      expect(content.errors[0]).toHaveProperty('metadata');
    });
  });

  describe('tools/call - get_error_details', () => {
    const mockIssue = {
      id: 'issue-1',
      shortId: 'TEST-1',
      title: 'TypeError: Cannot read property',
      culprit: 'test.js',
      count: 5,
      userCount: 3,
      firstSeen: '2025-01-01T00:00:00Z',
      lastSeen: '2025-01-15T10:00:00Z',
      level: 'error',
      status: 'unresolved',
      isUnhandled: true,
      permalink: 'https://sentry.io/issues/1',
      tags: [{ key: 'browser', value: 'Chrome', count: 5 }],
    };

    const mockEvent = {
      eventID: 'event-1',
      dateCreated: '2025-01-15T10:00:00Z',
      message: 'Cannot read property of undefined',
      platform: 'javascript',
      contexts: { browser: { name: 'Chrome' } },
      entries: [
        {
          type: 'exception',
          data: { values: [{ type: 'TypeError', value: 'Cannot read' }] },
        },
      ],
    };

    beforeEach(async () => {
      mockAxiosInstance.get.mockImplementation((url: string) => {
        if (url.includes('/events/latest')) {
          return Promise.resolve({ data: mockEvent });
        }
        if (url.includes('/issues/issue-1')) {
          return Promise.resolve({ data: mockIssue });
        }
        if (url.includes('/organizations/')) {
          return Promise.resolve({ data: {} });
        }
        return Promise.resolve({ data: {} });
      });
      await server.initialize();
    });

    it('should return error details', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_error_details',
          arguments: { issue_id: 'issue-1' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(false);

      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.id).toBe('issue-1');
      expect(content.tags).toBeInstanceOf(Array);
      expect(content.latest_event).toBeDefined();
    });

    it('should require issue_id parameter', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_error_details',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(true);
    });
  });

  describe('tools/call - search_errors', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockImplementation((url: string) => {
        if (url.includes('/issues/')) {
          return Promise.resolve({
            data: [
              {
                id: 'issue-1',
                shortId: 'TEST-1',
                title: 'Search result',
                count: 1,
                lastSeen: '2025-01-15T10:00:00Z',
                level: 'error',
                status: 'unresolved',
                permalink: 'https://sentry.io/issues/1',
              },
            ],
          });
        }
        return Promise.resolve({ data: {} });
      });
      await server.initialize();
    });

    it('should search errors by query', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'search_errors',
          arguments: { query: 'is:unresolved TypeError' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(false);

      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.query).toBe('is:unresolved TypeError');
      expect(content.results).toBeInstanceOf(Array);
    });

    it('should require query parameter', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'search_errors',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(true);
    });
  });

  describe('tools/call - get_service_health', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockImplementation((url: string) => {
        if (url.includes('/issues/')) {
          return Promise.resolve({
            data: [
              { id: 'issue-1', level: 'error', status: 'unresolved', count: 10 },
              { id: 'issue-2', level: 'warning', status: 'resolved', count: 5 },
            ],
          });
        }
        if (url.includes('/stats/')) {
          return Promise.resolve({
            data: [[1704067200, 100], [1704070800, 150]],
          });
        }
        return Promise.resolve({ data: {} });
      });
      await server.initialize();
    });

    it('should return service health overview', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_service_health',
          arguments: { time_range: '24h' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(false);

      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.project).toBe('test-project');
      expect(content.summary).toBeDefined();
      expect(content.severity_breakdown).toBeDefined();
    });
  });

  describe('healthCheck()', () => {
    it('should return healthy status when connection succeeds', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });
      await server.initialize();

      const health = await server.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.details?.connected).toBe(true);
    });

    it('should return unhealthy status when connection fails', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} }); // initialize
      await server.initialize();

      mockAxiosInstance.get.mockRejectedValue(new Error('Connection failed'));

      const health = await server.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.details?.connected).toBe(false);
    });
  });

  describe('shutdown()', () => {
    it('should set initialized flag to false', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });
      await server.initialize();
      expect(server.isInitialized()).toBe(true);

      await server.shutdown();

      expect(server.isInitialized()).toBe(false);
    });
  });
});
