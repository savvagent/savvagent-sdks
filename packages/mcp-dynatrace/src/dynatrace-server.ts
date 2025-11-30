/**
 * Savvagent Dynatrace MCP Server
 * Pull-based MCP server that exposes Dynatrace APM and monitoring data via JSON-RPC 2.0 tools
 */

import axios, { AxiosInstance } from 'axios';
import { MCPServer, MCPServerConfig } from '@savvagent/mcp-sdk';

/**
 * Dynatrace configuration options
 */
export interface DynatraceConfig {
  /** Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com) */
  environmentUrl: string;
  /** Dynatrace API token */
  apiToken: string;
  /** Default management zone (optional) */
  managementZone?: string;
}

/**
 * Dynatrace MCP Server
 */
export class DynatraceMCPServer extends MCPServer {
  private apiClient!: AxiosInstance;
  private dynatraceConfig: DynatraceConfig;

  constructor(config: MCPServerConfig, dynatraceConfig: DynatraceConfig) {
    super(config);
    this.dynatraceConfig = dynatraceConfig;
    this.registerDynatraceTools();
  }

  async initialize(): Promise<void> {
    this.apiClient = axios.create({
      baseURL: `${this.dynatraceConfig.environmentUrl}/api`,
      headers: {
        Authorization: `Api-Token ${this.dynatraceConfig.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    try {
      await this.apiClient.get('/v1/time');
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to Dynatrace: ${error}`);
    }
  }

  private registerDynatraceTools(): void {
    // get_problems - Get active problems
    this.registerTool(
      'get_problems',
      'Get active problems/incidents from Dynatrace',
      {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Problem status filter',
            enum: ['OPEN', 'RESOLVED'],
          },
          severity: {
            type: 'string',
            description: 'Minimum severity level',
            enum: ['AVAILABILITY', 'ERROR', 'PERFORMANCE', 'RESOURCE_CONTENTION', 'CUSTOM_ALERT'],
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['1h', '6h', '24h', '7d', '30d'],
            default: '24h',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results',
            minimum: 1,
            maximum: 500,
            default: 100,
          },
        },
        required: [],
      },
      async (args) => this.getProblems(args)
    );

    // get_problem_details - Get problem details
    this.registerTool(
      'get_problem_details',
      'Get detailed information about a specific problem',
      {
        type: 'object',
        properties: {
          problem_id: {
            type: 'string',
            description: 'The problem ID',
          },
        },
        required: ['problem_id'],
      },
      async (args) => this.getProblemDetails(args.problem_id)
    );

    // get_services - Get monitored services
    this.registerTool(
      'get_services',
      'Get list of monitored services',
      {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'Filter by tag',
          },
          management_zone: {
            type: 'string',
            description: 'Filter by management zone',
          },
        },
        required: [],
      },
      async (args) => this.getServices(args)
    );

    // get_service_metrics - Get service metrics
    this.registerTool(
      'get_service_metrics',
      'Get metrics for a specific service',
      {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: 'The service entity ID',
          },
          metrics: {
            type: 'string',
            description: 'Comma-separated metric keys',
            default: 'builtin:service.response.time,builtin:service.errors.total.rate',
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['15m', '1h', '6h', '24h', '7d'],
            default: '1h',
          },
        },
        required: ['service_id'],
      },
      async (args) => this.getServiceMetrics(args)
    );

    // get_hosts - Get monitored hosts
    this.registerTool(
      'get_hosts',
      'Get list of monitored hosts',
      {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'Filter by tag',
          },
          management_zone: {
            type: 'string',
            description: 'Filter by management zone',
          },
        },
        required: [],
      },
      async (args) => this.getHosts(args)
    );

    // get_logs - Query logs
    this.registerTool(
      'get_logs',
      'Query logs from Dynatrace',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'DQL log query',
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['15m', '1h', '6h', '24h', '7d'],
            default: '1h',
          },
          limit: {
            type: 'integer',
            description: 'Maximum results',
            minimum: 1,
            maximum: 1000,
            default: 100,
          },
        },
        required: ['query'],
      },
      async (args) => this.getLogs(args)
    );

    // get_synthetic_monitors - Get synthetic monitors
    this.registerTool(
      'get_synthetic_monitors',
      'Get synthetic monitor status and results',
      {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Monitor type filter',
            enum: ['HTTP', 'BROWSER'],
          },
          enabled: {
            type: 'boolean',
            description: 'Filter by enabled status',
          },
        },
        required: [],
      },
      async (args) => this.getSyntheticMonitors(args)
    );

    // get_service_health - Get overall service health
    this.registerTool(
      'get_service_health',
      'Get health overview of monitored services',
      {
        type: 'object',
        properties: {
          management_zone: {
            type: 'string',
            description: 'Filter by management zone',
          },
          time_range: {
            type: 'string',
            description: 'Time range for health calculation',
            enum: ['15m', '1h', '6h', '24h'],
            default: '1h',
          },
        },
        required: [],
      },
      async (args) => this.getServiceHealth(args)
    );

    // get_events - Get events
    this.registerTool(
      'get_events',
      'Get events from Dynatrace',
      {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            description: 'Filter by event type',
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['1h', '6h', '24h', '7d'],
            default: '24h',
          },
        },
        required: [],
      },
      async (args) => this.getEvents(args)
    );
  }

  private getTimeRangeMs(timeRange: string): { from: number; to: number } {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    return {
      from: now - (ranges[timeRange] || ranges['1h']),
      to: now,
    };
  }

  private async getProblems(args: {
    status?: string;
    severity?: string;
    time_range?: string;
    limit?: number;
  }) {
    const { from, to } = this.getTimeRangeMs(args.time_range || '24h');

    const params: Record<string, any> = {
      from,
      to,
      pageSize: args.limit || 100,
    };

    if (args.status) {
      params.status = args.status;
    }
    if (args.severity) {
      params.severityLevel = args.severity;
    }
    if (this.dynatraceConfig.managementZone) {
      params.managementZone = this.dynatraceConfig.managementZone;
    }

    const response = await this.apiClient.get('/v2/problems', { params });

    return {
      problems: (response.data.problems || []).map((p: any) => ({
        id: p.problemId,
        title: p.title,
        status: p.status,
        severity: p.severityLevel,
        impact: p.impactLevel,
        start_time: new Date(p.startTime).toISOString(),
        end_time: p.endTime ? new Date(p.endTime).toISOString() : null,
        affected_entities: p.affectedEntities?.map((e: any) => ({
          id: e.entityId?.id,
          name: e.name,
          type: e.entityId?.type,
        })),
        root_cause: p.rootCauseEntity ? {
          id: p.rootCauseEntity.entityId?.id,
          name: p.rootCauseEntity.name,
          type: p.rootCauseEntity.entityId?.type,
        } : null,
      })),
      meta: {
        total: response.data.totalCount,
        time_range: args.time_range || '24h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getProblemDetails(problemId: string) {
    const response = await this.apiClient.get(`/v2/problems/${problemId}`);
    const p = response.data;

    return {
      id: p.problemId,
      title: p.title,
      status: p.status,
      severity: p.severityLevel,
      impact: p.impactLevel,
      start_time: new Date(p.startTime).toISOString(),
      end_time: p.endTime ? new Date(p.endTime).toISOString() : null,
      affected_entities: p.affectedEntities?.map((e: any) => ({
        id: e.entityId?.id,
        name: e.name,
        type: e.entityId?.type,
      })),
      root_cause: p.rootCauseEntity ? {
        id: p.rootCauseEntity.entityId?.id,
        name: p.rootCauseEntity.name,
        type: p.rootCauseEntity.entityId?.type,
      } : null,
      evidence_details: p.evidenceDetails,
      recent_comments: p.recentComments,
    };
  }

  private async getServices(args: { tag?: string; management_zone?: string }) {
    const params: Record<string, string> = {
      entitySelector: 'type("SERVICE")',
    };

    if (args.tag) {
      params.entitySelector += `,tag("${args.tag}")`;
    }
    if (args.management_zone || this.dynatraceConfig.managementZone) {
      params.entitySelector += `,mzName("${args.management_zone || this.dynatraceConfig.managementZone}")`;
    }

    const response = await this.apiClient.get('/v2/entities', { params });

    return {
      services: (response.data.entities || []).map((s: any) => ({
        id: s.entityId,
        name: s.displayName,
        type: s.type,
        tags: s.tags?.map((t: any) => `${t.context}:${t.key}:${t.value}`),
        management_zones: s.managementZones?.map((mz: any) => mz.name),
      })),
      meta: {
        total: response.data.totalCount,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getServiceMetrics(args: {
    service_id: string;
    metrics?: string;
    time_range?: string;
  }) {
    const { from, to } = this.getTimeRangeMs(args.time_range || '1h');
    const metricSelector = args.metrics || 'builtin:service.response.time,builtin:service.errors.total.rate';

    const response = await this.apiClient.get('/v2/metrics/query', {
      params: {
        metricSelector,
        entitySelector: `entityId("${args.service_id}")`,
        from,
        to,
        resolution: 'Inf',
      },
    });

    return {
      service_id: args.service_id,
      metrics: (response.data.result || []).map((m: any) => ({
        metric_id: m.metricId,
        data: m.data?.map((d: any) => ({
          dimensions: d.dimensions,
          values: d.values,
          timestamps: d.timestamps?.map((t: number) => new Date(t).toISOString()),
        })),
      })),
      meta: {
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getHosts(args: { tag?: string; management_zone?: string }) {
    const params: Record<string, string> = {
      entitySelector: 'type("HOST")',
    };

    if (args.tag) {
      params.entitySelector += `,tag("${args.tag}")`;
    }
    if (args.management_zone || this.dynatraceConfig.managementZone) {
      params.entitySelector += `,mzName("${args.management_zone || this.dynatraceConfig.managementZone}")`;
    }

    const response = await this.apiClient.get('/v2/entities', { params });

    return {
      hosts: (response.data.entities || []).map((h: any) => ({
        id: h.entityId,
        name: h.displayName,
        type: h.type,
        tags: h.tags?.map((t: any) => `${t.context}:${t.key}:${t.value}`),
        properties: h.properties,
      })),
      meta: {
        total: response.data.totalCount,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getLogs(args: { query: string; time_range?: string; limit?: number }) {
    const { from, to } = this.getTimeRangeMs(args.time_range || '1h');

    const response = await this.apiClient.post('/v2/logs/search', {
      query: args.query,
      from,
      to,
      limit: args.limit || 100,
      sort: '-timestamp',
    });

    return {
      logs: (response.data.results || []).map((l: any) => ({
        timestamp: l.timestamp,
        content: l.content,
        status: l.status,
        host: l.dt?.entity?.host,
        service: l.dt?.entity?.service,
      })),
      meta: {
        total: response.data.results?.length || 0,
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getSyntheticMonitors(args: { type?: string; enabled?: boolean }) {
    const response = await this.apiClient.get('/v1/synthetic/monitors');

    let monitors = response.data.monitors || [];

    if (args.type) {
      monitors = monitors.filter((m: any) => m.type === args.type);
    }
    if (args.enabled !== undefined) {
      monitors = monitors.filter((m: any) => m.enabled === args.enabled);
    }

    return {
      monitors: monitors.map((m: any) => ({
        id: m.entityId,
        name: m.name,
        type: m.type,
        enabled: m.enabled,
        frequency_min: m.frequencyMin,
        locations: m.locations,
        status: m.monitorStatus,
        created: m.createdFrom,
      })),
      meta: {
        total: monitors.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getServiceHealth(args: { management_zone?: string; time_range?: string }) {
    const services = await this.getServices({ management_zone: args.management_zone });
    const problems = await this.getProblems({ time_range: args.time_range || '1h', status: 'OPEN' });

    const affectedServiceIds = new Set(
      problems.problems.flatMap((p: any) =>
        (p.affected_entities || [])
          .filter((e: any) => e.type === 'SERVICE')
          .map((e: any) => e.id)
      )
    );

    const servicesWithHealth = services.services.map((s: any) => ({
      ...s,
      status: affectedServiceIds.has(s.id) ? 'impacted' : 'healthy',
    }));

    return {
      services: servicesWithHealth,
      summary: {
        total: servicesWithHealth.length,
        healthy: servicesWithHealth.filter((s: any) => s.status === 'healthy').length,
        impacted: servicesWithHealth.filter((s: any) => s.status === 'impacted').length,
        open_problems: problems.meta.total,
      },
      meta: {
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getEvents(args: { event_type?: string; time_range?: string }) {
    const { from, to } = this.getTimeRangeMs(args.time_range || '24h');

    const params: Record<string, any> = { from, to };
    if (args.event_type) {
      params.eventType = args.event_type;
    }

    const response = await this.apiClient.get('/v2/events', { params });

    return {
      events: (response.data.events || []).map((e: any) => ({
        id: e.eventId,
        type: e.eventType,
        title: e.title,
        start_time: new Date(e.startTime).toISOString(),
        end_time: e.endTime ? new Date(e.endTime).toISOString() : null,
        entity_id: e.entityId,
        properties: e.properties,
      })),
      meta: {
        total: response.data.totalCount,
        time_range: args.time_range || '24h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  async healthCheck() {
    try {
      await this.apiClient.get('/v1/time');
      return {
        status: 'ok' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          environment: this.dynatraceConfig.environmentUrl,
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          environment: this.dynatraceConfig.environmentUrl,
          connected: false,
          error: String(error),
        },
      };
    }
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
  }
}
