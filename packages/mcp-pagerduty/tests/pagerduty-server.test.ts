import { PagerDutyMCPServer, PagerDutyConfig } from '../src/pagerduty-server';
import { JsonRpcRequest } from '@savvagent/mcp-sdk';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  })),
}));

import axios from 'axios';

describe('PagerDutyMCPServer', () => {
  let server: PagerDutyMCPServer;
  let mockAxiosInstance: any;

  const mockConfig = {
    name: 'test-pagerduty-server',
    version: '1.0.0',
  };

  const mockPagerDutyConfig: PagerDutyConfig = {
    apiToken: 'test-api-token',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    server = new PagerDutyMCPServer(mockConfig, mockPagerDutyConfig);
  });

  afterEach(async () => {
    await server.shutdown();
  });

  describe('constructor', () => {
    it('should create a PagerDuty MCP server with correct config', () => {
      expect(server).toBeInstanceOf(PagerDutyMCPServer);
    });

    it('should register all PagerDuty tools', () => {
      const tools = server.getTools();
      expect(tools).toHaveLength(11);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('get_incidents');
      expect(toolNames).toContain('get_incident_details');
      expect(toolNames).toContain('get_services');
      expect(toolNames).toContain('get_on_call');
      expect(toolNames).toContain('get_schedules');
      expect(toolNames).toContain('get_escalation_policies');
      expect(toolNames).toContain('get_users');
      expect(toolNames).toContain('get_analytics');
      expect(toolNames).toContain('create_incident');
      expect(toolNames).toContain('update_incident');
      expect(toolNames).toContain('get_alerts');
    });
  });

  describe('initialize', () => {
    it('should initialize with correct API headers', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });

      await server.initialize();

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.pagerduty.com',
          headers: expect.objectContaining({
            'Authorization': 'Token token=test-api-token',
          }),
        })
      );
    });

    it('should throw error on connection failure', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(server.initialize()).rejects.toThrow('Failed to connect to PagerDuty');
    });
  });

  describe('get_incidents tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should fetch incidents with default parameters', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          incidents: [
            {
              id: 'P123',
              incident_number: 1,
              title: 'Test Incident',
              status: 'triggered',
              urgency: 'high',
              service: { id: 'S1', summary: 'Test Service' },
              created_at: '2024-01-15T10:00:00Z',
            },
          ],
          more: false,
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_incidents',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      expect((response as any).result.isError).toBe(false);

      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.incidents).toHaveLength(1);
      expect(content.incidents[0].id).toBe('P123');
    });

    it('should filter incidents by status', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { incidents: [], more: false },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_incidents',
          arguments: { status: ['triggered', 'acknowledged'] },
        },
        id: 1,
      };

      await server.handleRequest(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('statuses%5B%5D=triggered')
      );
    });

    it('should filter incidents by urgency', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { incidents: [], more: false },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_incidents',
          arguments: { urgency: 'high' },
        },
        id: 1,
      };

      await server.handleRequest(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('urgencies%5B%5D=high')
      );
    });
  });

  describe('get_incident_details tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should fetch incident details with timeline', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: {
            incident: {
              id: 'P123',
              incident_number: 1,
              title: 'Test Incident',
              status: 'triggered',
              html_url: 'https://pagerduty.com/incidents/P123',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            log_entries: [
              {
                id: 'L1',
                type: 'trigger_log_entry',
                summary: 'Incident triggered',
                created_at: '2024-01-15T10:00:00Z',
              },
            ],
          },
        });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_incident_details',
          arguments: { incident_id: 'P123' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.incident.id).toBe('P123');
      expect(content.timeline).toHaveLength(1);
    });
  });

  describe('get_services tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should list services', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          services: [
            {
              id: 'S1',
              name: 'Production API',
              status: 'active',
              escalation_policy: { id: 'EP1', summary: 'Default EP' },
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_services',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.services).toHaveLength(1);
      expect(content.services[0].name).toBe('Production API');
    });

    it('should filter services by query', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { services: [] },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_services',
          arguments: { query: 'production' },
        },
        id: 1,
      };

      await server.handleRequest(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('query=production')
      );
    });
  });

  describe('get_on_call tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should fetch on-call users', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          oncalls: [
            {
              user: { id: 'U1', summary: 'John Doe', email: 'john@example.com' },
              schedule: { id: 'SCH1', summary: 'Primary' },
              escalation_level: 1,
              start: '2024-01-15T00:00:00Z',
              end: '2024-01-22T00:00:00Z',
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_on_call',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.oncalls[0].user.name).toBe('John Doe');
      expect(content.oncalls[0].escalation_level).toBe(1);
    });
  });

  describe('get_schedules tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should list schedules', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          schedules: [
            {
              id: 'SCH1',
              name: 'Primary On-Call',
              time_zone: 'America/New_York',
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_schedules',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.schedules[0].name).toBe('Primary On-Call');
    });
  });

  describe('get_escalation_policies tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should list escalation policies', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          escalation_policies: [
            {
              id: 'EP1',
              name: 'Default Policy',
              num_loops: 2,
              escalation_rules: [
                {
                  escalation_delay_in_minutes: 30,
                  targets: [{ id: 'U1', type: 'user', summary: 'John Doe' }],
                },
              ],
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_escalation_policies',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.escalation_policies[0].name).toBe('Default Policy');
      expect(content.escalation_policies[0].escalation_rules).toHaveLength(1);
    });
  });

  describe('get_users tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should list users', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          users: [
            {
              id: 'U1',
              name: 'John Doe',
              email: 'john@example.com',
              role: 'admin',
              time_zone: 'America/New_York',
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_users',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.users[0].name).toBe('John Doe');
      expect(content.users[0].role).toBe('admin');
    });
  });

  describe('get_analytics tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should calculate incident analytics', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          incidents: [
            {
              id: 'P1',
              status: 'resolved',
              urgency: 'high',
              service: { id: 'S1', summary: 'API' },
              created_at: '2024-01-15T10:00:00Z',
              resolved_at: '2024-01-15T11:00:00Z',
            },
            {
              id: 'P2',
              status: 'triggered',
              urgency: 'low',
              service: { id: 'S2', summary: 'Web' },
              created_at: '2024-01-15T12:00:00Z',
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_analytics',
          arguments: {},
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.summary.total_incidents).toBe(2);
      expect(content.summary.by_status).toHaveProperty('resolved');
      expect(content.summary.by_urgency).toHaveProperty('high');
    });
  });

  describe('create_incident tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should create a new incident', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          incident: {
            id: 'P123',
            incident_number: 1,
            title: 'New Incident',
            status: 'triggered',
            urgency: 'high',
            created_at: '2024-01-15T10:00:00Z',
            html_url: 'https://pagerduty.com/incidents/P123',
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create_incident',
          arguments: {
            title: 'New Incident',
            service_id: 'S1',
            urgency: 'high',
            body: 'This is a test incident',
          },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.incident.id).toBe('P123');
      expect(content.incident.title).toBe('New Incident');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/incidents',
        expect.objectContaining({
          incident: expect.objectContaining({
            title: 'New Incident',
            urgency: 'high',
          }),
        })
      );
    });
  });

  describe('update_incident tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should acknowledge an incident', async () => {
      mockAxiosInstance.put.mockResolvedValueOnce({
        data: {
          incident: {
            id: 'P123',
            incident_number: 1,
            title: 'Test Incident',
            status: 'acknowledged',
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'update_incident',
          arguments: {
            incident_id: 'P123',
            status: 'acknowledged',
          },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.incident.status).toBe('acknowledged');
    });

    it('should resolve an incident with resolution note', async () => {
      mockAxiosInstance.put.mockResolvedValueOnce({
        data: {
          incident: {
            id: 'P123',
            status: 'resolved',
            resolved_at: '2024-01-15T12:00:00Z',
          },
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'update_incident',
          arguments: {
            incident_id: 'P123',
            status: 'resolved',
            resolution: 'Fixed by restarting the service',
          },
        },
        id: 1,
      };

      await server.handleRequest(request);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/incidents/P123',
        expect.objectContaining({
          incident: expect.objectContaining({
            status: 'resolved',
            resolution: 'Fixed by restarting the service',
          }),
        })
      );
    });
  });

  describe('get_alerts tool', () => {
    beforeEach(async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { users: [] } });
      await server.initialize();
    });

    it('should fetch alerts for an incident', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          alerts: [
            {
              id: 'A1',
              type: 'alert',
              status: 'triggered',
              severity: 'critical',
              summary: 'High CPU usage',
              created_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_alerts',
          arguments: { incident_id: 'P123' },
        },
        id: 1,
      };

      const response = await server.handleRequest(request);

      expect(response).toHaveProperty('result');
      const content = JSON.parse((response as any).result.content[0].text);
      expect(content.alerts[0].summary).toBe('High CPU usage');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when connected', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { users: [] } })
        .mockResolvedValueOnce({ data: { abilities: [] } });

      await server.initialize();
      const health = await server.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.details.connected).toBe(true);
    });

    it('should return unhealthy status on API failure', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { users: [] } })
        .mockRejectedValueOnce(new Error('API error'));

      await server.initialize();
      const health = await server.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.details.connected).toBe(false);
    });
  });

  describe('tool input schemas', () => {
    it('get_incidents should have correct schema', () => {
      const tool = server.getTools().find(t => t.name === 'get_incidents');
      expect(tool?.inputSchema.properties).toHaveProperty('status');
      expect(tool?.inputSchema.properties).toHaveProperty('urgency');
      expect(tool?.inputSchema.properties).toHaveProperty('service_ids');
    });

    it('get_incident_details should require incident_id', () => {
      const tool = server.getTools().find(t => t.name === 'get_incident_details');
      expect(tool?.inputSchema.required).toContain('incident_id');
    });

    it('create_incident should require title and service_id', () => {
      const tool = server.getTools().find(t => t.name === 'create_incident');
      expect(tool?.inputSchema.required).toContain('title');
      expect(tool?.inputSchema.required).toContain('service_id');
    });

    it('update_incident should require incident_id and status', () => {
      const tool = server.getTools().find(t => t.name === 'update_incident');
      expect(tool?.inputSchema.required).toContain('incident_id');
      expect(tool?.inputSchema.required).toContain('status');
    });
  });
});
