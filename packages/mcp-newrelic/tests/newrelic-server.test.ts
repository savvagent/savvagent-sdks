import { NewRelicMCPServer, NewRelicConfig } from '../src/newrelic-server';
import { JsonRpcRequest } from '@savvagent/mcp-sdk';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: jest.fn(),
    get: jest.fn(),
  })),
}));

import axios from 'axios';

describe('NewRelicMCPServer', () => {
  let server: NewRelicMCPServer;
  let mockAxiosInstance: any;

  const mockConfig = {
    name: 'test-newrelic-server',
    version: '1.0.0',
  };

  const mockNewRelicConfig: NewRelicConfig = {
    apiKey: 'test-api-key',
    accountId: '12345',
    region: 'US' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    server = new NewRelicMCPServer(mockConfig, mockNewRelicConfig);
  });

  afterEach(async () => {
    await server.shutdown();
  });

  describe('constructor', () => {
    it('should create a New Relic MCP server with correct config', () => {
      expect(server).toBeInstanceOf(NewRelicMCPServer);
    });

    it('should register all New Relic tools', () => {
      const tools = server.getTools();
      expect(tools).toHaveLength(9);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('get_errors');
      expect(toolNames).toContain('run_nrql');
      expect(toolNames).toContain('get_apm_metrics');
      expect(toolNames).toContain('get_applications');
      expect(toolNames).toContain('get_alerts');
      expect(toolNames).toContain('get_transactions');
      expect(toolNames).toContain('get_infrastructure');
      expect(toolNames).toContain('get_synthetics');
      expect(toolNames).toContain('get_service_health');
    });
  });

  describe('initialize', () => {
    it('should initialize with US region API endpoints', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [{ count: 100 }],
                },
              },
            },
          },
        },
      });

      await server.initialize();

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.newrelic.com',
        })
      );
    });

    it('should initialize with EU region API endpoints', async () => {
      const euConfig: NewRelicConfig = {
        apiKey: 'test-api-key',
        accountId: '12345',
        region: 'EU',
      };

      const euServer = new NewRelicMCPServer(mockConfig, euConfig);

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [{ count: 100 }],
                },
              },
            },
          },
        },
      });

      await euServer.initialize();

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.eu.newrelic.com',
        })
      );

      await euServer.shutdown();
    });

    it('should throw error on connection failure', async () => {
      mockAxiosInstance.post.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(server.initialize()).rejects.toThrow('Failed to connect to New Relic');
    });
  });

  describe('get_errors tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch errors with default parameters', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    {
                      timestamp: Date.now(),
                      appName: 'test-app',
                      'error.class': 'RuntimeError',
                      'error.message': 'Test error',
                      transactionName: '/api/test',
                      host: 'test-host',
                    },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_errors',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(false);

      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.errors).toHaveLength(1);
      expect(content.meta).toBeDefined();
    });

    it('should filter errors by app name', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_errors',
          arguments: { app_name: 'my-app' },
        },
        id: 1,
      };

      await server.handleRequest(request);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          query: expect.stringContaining("appName = 'my-app'"),
        })
      );
    });
  });

  describe('run_nrql tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should execute NRQL query', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [{ count: 42 }],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'run_nrql',
          arguments: { query: 'SELECT count(*) FROM Transaction' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.query).toBe('SELECT count(*) FROM Transaction');
    });
  });

  describe('get_apm_metrics tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch APM metrics for an application', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    { beginTimeSeconds: 1700000000, rpm: 100 },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_apm_metrics',
          arguments: { app_name: 'test-app' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.app_name).toBe('test-app');
      expect(content.metrics).toHaveProperty('throughput');
      expect(content.metrics).toHaveProperty('avg_response_time_ms');
      expect(content.metrics).toHaveProperty('error_rate');
    });
  });

  describe('get_applications tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should list applications', async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            data: {
              actor: {
                account: {
                  nrql: {
                    results: [{ 'uniques.appName': ['app1', 'app2'] }],
                  },
                },
              },
            },
          },
        })
        .mockResolvedValue({
          data: {
            data: {
              actor: {
                account: {
                  nrql: {
                    results: [{ count: 100, errorRate: 0.5 }],
                  },
                },
              },
            },
          },
        });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_applications',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.applications).toBeDefined();
      expect(content.meta).toBeDefined();
    });
  });

  describe('get_alerts tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch alert incidents', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    {
                      incidentId: '123',
                      title: 'High error rate',
                      priority: 'critical',
                      state: 'open',
                    },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_alerts',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.incidents).toBeDefined();
      expect(content.meta).toBeDefined();
    });

    it('should filter alerts by status', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_alerts',
          arguments: { status: 'open' },
        },
        id: 1,
      };

      await server.handleRequest(request);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          query: expect.stringContaining("event = 'open'"),
        })
      );
    });
  });

  describe('get_transactions tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch transaction data', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    {
                      facet: '/api/users',
                      count: 1000,
                      'average.duration': 0.05,
                      'percentile.duration': 0.1,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_transactions',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.transactions).toBeDefined();
      expect(content.transactions[0]).toHaveProperty('name');
      expect(content.transactions[0]).toHaveProperty('count');
      expect(content.transactions[0]).toHaveProperty('avg_duration_ms');
    });
  });

  describe('get_infrastructure tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch infrastructure metrics', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    {
                      facet: 'host1',
                      'average.cpuPercent': 45,
                      'average.memoryUsedPercent': 60,
                      'average.diskUsedPercent': 70,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_infrastructure',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.hosts).toBeDefined();
      expect(content.hosts[0]).toHaveProperty('hostname');
      expect(content.hosts[0]).toHaveProperty('cpu_percent');
      expect(content.hosts[0]).toHaveProperty('memory_percent');
    });
  });

  describe('get_synthetics tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch synthetic monitor results', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    {
                      facet: 'Homepage Monitor',
                      count: 100,
                      successRate: 99.5,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_synthetics',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.monitors).toBeDefined();
      expect(content.monitors[0]).toHaveProperty('name');
      expect(content.monitors[0]).toHaveProperty('success_rate');
      expect(content.monitors[0]).toHaveProperty('status');
    });
  });

  describe('get_service_health tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();
    });

    it('should fetch service health', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [
                    {
                      facet: 'service-1',
                      count: 10000,
                      errorRate: 0.5,
                      'average.duration': 0.025,
                    },
                    {
                      facet: 'service-2',
                      count: 5000,
                      errorRate: 6.0,
                      'average.duration': 0.1,
                    },
                  ],
                },
              },
            },
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_service_health',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.services).toBeDefined();
      expect(content.summary).toBeDefined();
      expect(content.summary).toHaveProperty('healthy');
      expect(content.summary).toHaveProperty('critical');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when connected', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [{ count: 1 }],
                },
              },
            },
          },
        },
      });

      await server.initialize();
      const health = await server.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.details.connected).toBe(true);
      expect(health.details.accountId).toBe('12345');
    });

    it('should return unhealthy status on API failure', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          data: {
            actor: {
              account: {
                nrql: {
                  results: [],
                },
              },
            },
          },
        },
      });
      await server.initialize();

      mockAxiosInstance.post.mockRejectedValueOnce(new Error('API error'));

      const health = await server.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.details.connected).toBe(false);
    });
  });

  describe('tool input schemas', () => {
    it('get_errors should have correct schema', () => {
      const tool = server.getTools().find(t => t.name === 'get_errors');
      expect(tool?.inputSchema.properties).toHaveProperty('app_name');
      expect(tool?.inputSchema.properties).toHaveProperty('time_range');
      expect(tool?.inputSchema.properties).toHaveProperty('limit');
    });

    it('run_nrql should require query', () => {
      const tool = server.getTools().find(t => t.name === 'run_nrql');
      expect(tool?.inputSchema.required).toContain('query');
    });

    it('get_apm_metrics should require app_name', () => {
      const tool = server.getTools().find(t => t.name === 'get_apm_metrics');
      expect(tool?.inputSchema.required).toContain('app_name');
    });

    it('get_alerts should have status and priority enums', () => {
      const tool = server.getTools().find(t => t.name === 'get_alerts');
      expect((tool?.inputSchema.properties as any)?.status?.enum).toEqual(['open', 'closed']);
      expect((tool?.inputSchema.properties as any)?.priority?.enum).toEqual(['critical', 'warning']);
    });

    it('get_synthetics should have status enum', () => {
      const tool = server.getTools().find(t => t.name === 'get_synthetics');
      expect((tool?.inputSchema.properties as any)?.status?.enum).toEqual(['SUCCESS', 'FAILED']);
    });
  });
});
