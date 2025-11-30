/**
 * Savvagent Datadog MCP Server
 * Pull-based MCP server that exposes Datadog APM, metrics, and monitoring data via JSON-RPC 2.0 tools
 */

import axios, { AxiosInstance } from 'axios';
import { MCPServer, MCPServerConfig } from '@savvagent/mcp-sdk';

/**
 * Datadog configuration options
 */
export interface DatadogConfig {
  /** Datadog API key */
  apiKey: string;
  /** Datadog Application key */
  appKey: string;
  /** Datadog site (e.g., datadoghq.com, datadoghq.eu, us3.datadoghq.com) */
  site?: string;
  /** Environment filter (optional) */
  environment?: string;
  /** Service filter (optional) */
  service?: string;
}

/**
 * Datadog MCP Server
 * Provides tools for querying Datadog APM, metrics, and monitoring data
 */
export class DatadogMCPServer extends MCPServer {
  private apiClient!: AxiosInstance;
  private datadogConfig: DatadogConfig;

  constructor(config: MCPServerConfig, datadogConfig: DatadogConfig) {
    super(config);
    this.datadogConfig = datadogConfig;
    this.registerDatadogTools();
  }

  /**
   * Initialize the Datadog API client
   */
  async initialize(): Promise<void> {
    const site = this.datadogConfig.site || 'datadoghq.com';
    this.apiClient = axios.create({
      baseURL: `https://api.${site}/api`,
      headers: {
        'DD-API-KEY': this.datadogConfig.apiKey,
        'DD-APPLICATION-KEY': this.datadogConfig.appKey,
        'Content-Type': 'application/json',
      },
    });

    // Verify connection
    try {
      await this.apiClient.get('/v1/validate');
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to Datadog: ${error}`);
    }
  }

  /**
   * Register Datadog-specific tools
   */
  private registerDatadogTools(): void {
    // get_errors - Fetch APM errors
    this.registerTool(
      'get_errors',
      'Fetch recent APM error traces from Datadog',
      {
        type: 'object',
        properties: {
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['15m', '1h', '4h', '1d', '2d', '7d'],
            default: '1h',
          },
          service: {
            type: 'string',
            description: 'Service name filter',
          },
          environment: {
            type: 'string',
            description: 'Environment filter (e.g., production, staging)',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results',
            minimum: 1,
            maximum: 1000,
            default: 100,
          },
        },
        required: [],
      },
      async (args) => this.getErrors(args)
    );

    // get_metrics - Fetch time-series metrics
    this.registerTool(
      'get_metrics',
      'Fetch time-series metrics from Datadog',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Datadog metrics query (e.g., "avg:system.cpu.user{*}")',
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['15m', '1h', '4h', '1d', '7d'],
            default: '1h',
          },
        },
        required: ['query'],
      },
      async (args) => this.getMetrics(args.query, args.time_range || '1h')
    );

    // get_traces - Fetch APM traces
    this.registerTool(
      'get_traces',
      'Fetch APM traces from Datadog',
      {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'Service name filter',
          },
          operation: {
            type: 'string',
            description: 'Operation name filter',
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['15m', '1h', '4h', '1d'],
            default: '1h',
          },
          min_duration_ms: {
            type: 'integer',
            description: 'Minimum trace duration in milliseconds',
          },
          status: {
            type: 'string',
            description: 'Trace status filter',
            enum: ['ok', 'error'],
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
        },
        required: [],
      },
      async (args) => this.getTraces(args)
    );

    // get_logs - Search logs
    this.registerTool(
      'get_logs',
      'Search and retrieve logs from Datadog',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Log search query (e.g., "status:error service:api")',
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['15m', '1h', '4h', '1d', '7d'],
            default: '1h',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results',
            minimum: 1,
            maximum: 1000,
            default: 100,
          },
        },
        required: ['query'],
      },
      async (args) => this.getLogs(args.query, args.time_range || '1h', args.limit || 100)
    );

    // get_monitors - Get monitor status
    this.registerTool(
      'get_monitors',
      'Get status of Datadog monitors/alerts',
      {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Filter monitors by name pattern',
          },
          tags: {
            type: 'string',
            description: 'Filter by tags (comma-separated)',
          },
          status: {
            type: 'string',
            description: 'Filter by status',
            enum: ['Alert', 'Warn', 'No Data', 'OK'],
          },
        },
        required: [],
      },
      async (args) => this.getMonitors(args)
    );

    // get_service_health - Get APM service health
    this.registerTool(
      'get_service_health',
      'Get health overview of APM services',
      {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'Specific service name (optional)',
          },
          environment: {
            type: 'string',
            description: 'Environment filter',
          },
          time_range: {
            type: 'string',
            description: 'Time range for statistics',
            enum: ['15m', '1h', '4h', '1d'],
            default: '1h',
          },
        },
        required: [],
      },
      async (args) => this.getServiceHealth(args)
    );

    // get_events - Get Datadog events
    this.registerTool(
      'get_events',
      'Get events from Datadog event stream',
      {
        type: 'object',
        properties: {
          priority: {
            type: 'string',
            description: 'Event priority',
            enum: ['normal', 'low'],
          },
          sources: {
            type: 'string',
            description: 'Comma-separated list of sources',
          },
          tags: {
            type: 'string',
            description: 'Comma-separated list of tags',
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['1h', '4h', '1d', '7d'],
            default: '1d',
          },
        },
        required: [],
      },
      async (args) => this.getEvents(args)
    );
  }

  /**
   * Get time range in seconds
   */
  private getTimeRangeSeconds(timeRange: string): number {
    const ranges: Record<string, number> = {
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
      '2d': 172800,
      '7d': 604800,
    };
    return ranges[timeRange] || 3600;
  }

  /**
   * Get APM errors
   */
  private async getErrors(args: {
    time_range?: string;
    service?: string;
    environment?: string;
    limit?: number;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - this.getTimeRangeSeconds(args.time_range || '1h');

    let query = 'status:error';
    if (args.service || this.datadogConfig.service) {
      query += ` service:${args.service || this.datadogConfig.service}`;
    }
    if (args.environment || this.datadogConfig.environment) {
      query += ` env:${args.environment || this.datadogConfig.environment}`;
    }

    const response = await this.apiClient.post('/v2/spans/events/search', {
      filter: {
        query,
        from: new Date(from * 1000).toISOString(),
        to: new Date(now * 1000).toISOString(),
      },
      sort: '-timestamp',
      page: {
        limit: args.limit || 100,
      },
    });

    const spans = response.data.data || [];

    return {
      errors: spans.map((span: any) => ({
        trace_id: span.attributes?.trace_id,
        span_id: span.attributes?.span_id,
        service: span.attributes?.service,
        resource: span.attributes?.resource_name,
        error_type: span.attributes?.['error.type'],
        error_message: span.attributes?.['error.message'],
        timestamp: span.attributes?.timestamp,
        duration_ns: span.attributes?.duration,
        environment: span.attributes?.env,
        host: span.attributes?.host,
      })),
      meta: {
        total: spans.length,
        time_range: args.time_range || '1h',
        query,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get time-series metrics
   */
  private async getMetrics(query: string, timeRange: string) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - this.getTimeRangeSeconds(timeRange);

    const response = await this.apiClient.get('/v1/query', {
      params: {
        query,
        from,
        to: now,
      },
    });

    const series = response.data.series || [];

    return {
      query,
      time_range: timeRange,
      series: series.map((s: any) => ({
        metric: s.metric,
        display_name: s.display_name,
        scope: s.scope,
        unit: s.unit?.[0]?.name,
        points: s.pointlist?.map((p: any) => ({
          timestamp: new Date(p[0]).toISOString(),
          value: p[1],
        })),
        statistics: {
          avg: s.pointlist?.reduce((sum: number, p: any) => sum + (p[1] || 0), 0) / (s.pointlist?.length || 1),
          min: Math.min(...(s.pointlist?.map((p: any) => p[1]) || [0])),
          max: Math.max(...(s.pointlist?.map((p: any) => p[1]) || [0])),
        },
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get APM traces
   */
  private async getTraces(args: {
    service?: string;
    operation?: string;
    time_range?: string;
    min_duration_ms?: number;
    status?: string;
    limit?: number;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - this.getTimeRangeSeconds(args.time_range || '1h');

    let query = '*';
    const filters: string[] = [];

    if (args.service || this.datadogConfig.service) {
      filters.push(`service:${args.service || this.datadogConfig.service}`);
    }
    if (args.operation) {
      filters.push(`resource_name:${args.operation}`);
    }
    if (args.status) {
      filters.push(`status:${args.status}`);
    }
    if (args.min_duration_ms) {
      filters.push(`@duration:>${args.min_duration_ms * 1000000}`);
    }
    if (this.datadogConfig.environment) {
      filters.push(`env:${this.datadogConfig.environment}`);
    }

    if (filters.length > 0) {
      query = filters.join(' ');
    }

    const response = await this.apiClient.post('/v2/spans/events/search', {
      filter: {
        query,
        from: new Date(from * 1000).toISOString(),
        to: new Date(now * 1000).toISOString(),
      },
      sort: '-timestamp',
      page: {
        limit: args.limit || 50,
      },
    });

    const spans = response.data.data || [];

    return {
      traces: spans.map((span: any) => ({
        trace_id: span.attributes?.trace_id,
        span_id: span.attributes?.span_id,
        service: span.attributes?.service,
        resource: span.attributes?.resource_name,
        operation: span.attributes?.operation_name,
        duration_ms: (span.attributes?.duration || 0) / 1000000,
        status: span.attributes?.status,
        timestamp: span.attributes?.timestamp,
        environment: span.attributes?.env,
        host: span.attributes?.host,
        http_status_code: span.attributes?.['http.status_code'],
      })),
      meta: {
        total: spans.length,
        time_range: args.time_range || '1h',
        query,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Search logs
   */
  private async getLogs(query: string, timeRange: string, limit: number) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - this.getTimeRangeSeconds(timeRange);

    let fullQuery = query;
    if (this.datadogConfig.service) {
      fullQuery += ` service:${this.datadogConfig.service}`;
    }
    if (this.datadogConfig.environment) {
      fullQuery += ` env:${this.datadogConfig.environment}`;
    }

    const response = await this.apiClient.post('/v2/logs/events/search', {
      filter: {
        query: fullQuery,
        from: new Date(from * 1000).toISOString(),
        to: new Date(now * 1000).toISOString(),
      },
      sort: '-timestamp',
      page: {
        limit,
      },
    });

    const logs = response.data.data || [];

    return {
      logs: logs.map((log: any) => ({
        id: log.id,
        message: log.attributes?.message,
        status: log.attributes?.status,
        service: log.attributes?.service,
        host: log.attributes?.host,
        timestamp: log.attributes?.timestamp,
        tags: log.attributes?.tags,
        attributes: log.attributes?.attributes,
      })),
      meta: {
        total: logs.length,
        time_range: timeRange,
        query: fullQuery,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get monitor status
   */
  private async getMonitors(args: {
    name?: string;
    tags?: string;
    status?: string;
  }) {
    const params: Record<string, string> = {};

    if (args.name) {
      params.name = args.name;
    }
    if (args.tags) {
      params.monitor_tags = args.tags;
    }

    const response = await this.apiClient.get('/v1/monitor', { params });

    let monitors = response.data || [];

    // Filter by status if specified
    if (args.status) {
      monitors = monitors.filter((m: any) => m.overall_state === args.status);
    }

    return {
      monitors: monitors.map((monitor: any) => ({
        id: monitor.id,
        name: monitor.name,
        type: monitor.type,
        status: monitor.overall_state,
        message: monitor.message,
        query: monitor.query,
        tags: monitor.tags,
        created: monitor.created,
        modified: monitor.modified,
        priority: monitor.priority,
      })),
      summary: {
        total: monitors.length,
        by_status: {
          ok: monitors.filter((m: any) => m.overall_state === 'OK').length,
          alert: monitors.filter((m: any) => m.overall_state === 'Alert').length,
          warn: monitors.filter((m: any) => m.overall_state === 'Warn').length,
          no_data: monitors.filter((m: any) => m.overall_state === 'No Data').length,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get APM service health
   */
  private async getServiceHealth(args: {
    service?: string;
    environment?: string;
    time_range?: string;
  }) {
    const env = args.environment || this.datadogConfig.environment || '*';
    const timeRange = args.time_range || '1h';
    const now = Math.floor(Date.now() / 1000);
    const from = now - this.getTimeRangeSeconds(timeRange);

    // Get service statistics using metrics API
    const serviceFilter = args.service || this.datadogConfig.service || '*';

    const [requestsResponse, errorsResponse, latencyResponse] = await Promise.all([
      this.apiClient.get('/v1/query', {
        params: {
          query: `sum:trace.http.request.hits{service:${serviceFilter},env:${env}}.as_count()`,
          from,
          to: now,
        },
      }).catch(() => ({ data: { series: [] } })),
      this.apiClient.get('/v1/query', {
        params: {
          query: `sum:trace.http.request.errors{service:${serviceFilter},env:${env}}.as_count()`,
          from,
          to: now,
        },
      }).catch(() => ({ data: { series: [] } })),
      this.apiClient.get('/v1/query', {
        params: {
          query: `avg:trace.http.request.duration{service:${serviceFilter},env:${env}}`,
          from,
          to: now,
        },
      }).catch(() => ({ data: { series: [] } })),
    ]);

    const requests = requestsResponse.data.series?.[0]?.pointlist || [];
    const errors = errorsResponse.data.series?.[0]?.pointlist || [];
    const latency = latencyResponse.data.series?.[0]?.pointlist || [];

    const totalRequests = requests.reduce((sum: number, p: any) => sum + (p[1] || 0), 0);
    const totalErrors = errors.reduce((sum: number, p: any) => sum + (p[1] || 0), 0);
    const avgLatency = latency.length > 0
      ? latency.reduce((sum: number, p: any) => sum + (p[1] || 0), 0) / latency.length
      : 0;

    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    return {
      service: serviceFilter,
      environment: env,
      time_range: timeRange,
      summary: {
        total_requests: Math.round(totalRequests),
        total_errors: Math.round(totalErrors),
        error_rate_percent: Math.round(errorRate * 100) / 100,
        avg_latency_ms: Math.round(avgLatency * 1000) / 1000,
        status: errorRate > 5 ? 'critical' : errorRate > 1 ? 'degraded' : 'healthy',
      },
      metrics: {
        requests_over_time: requests.slice(-24).map((p: any) => ({
          timestamp: new Date(p[0]).toISOString(),
          value: p[1],
        })),
        errors_over_time: errors.slice(-24).map((p: any) => ({
          timestamp: new Date(p[0]).toISOString(),
          value: p[1],
        })),
        latency_over_time: latency.slice(-24).map((p: any) => ({
          timestamp: new Date(p[0]).toISOString(),
          value: p[1],
        })),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get events
   */
  private async getEvents(args: {
    priority?: string;
    sources?: string;
    tags?: string;
    time_range?: string;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - this.getTimeRangeSeconds(args.time_range || '1d');

    const params: Record<string, any> = {
      start: from,
      end: now,
    };

    if (args.priority) {
      params.priority = args.priority;
    }
    if (args.sources) {
      params.sources = args.sources;
    }
    if (args.tags) {
      params.tags = args.tags;
    }

    const response = await this.apiClient.get('/v1/events', { params });

    const events = response.data.events || [];

    return {
      events: events.map((event: any) => ({
        id: event.id,
        title: event.title,
        text: event.text,
        priority: event.priority,
        source: event.source,
        alert_type: event.alert_type,
        host: event.host,
        tags: event.tags,
        timestamp: new Date(event.date_happened * 1000).toISOString(),
      })),
      meta: {
        total: events.length,
        time_range: args.time_range || '1d',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Health check - verify Datadog connection
   */
  async healthCheck() {
    try {
      await this.apiClient.get('/v1/validate');
      return {
        status: 'ok' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          site: this.datadogConfig.site || 'datadoghq.com',
          service: this.datadogConfig.service,
          environment: this.datadogConfig.environment,
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          site: this.datadogConfig.site || 'datadoghq.com',
          connected: false,
          error: String(error),
        },
      };
    }
  }

  /**
   * Shutdown - cleanup
   */
  async shutdown(): Promise<void> {
    await super.shutdown();
  }
}
