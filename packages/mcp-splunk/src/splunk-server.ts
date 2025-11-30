/**
 * Savvagent Splunk MCP Server
 * Pull-based MCP server that exposes Splunk log analytics via JSON-RPC 2.0 tools
 */

import axios, { AxiosInstance } from 'axios';
import { MCPServer, MCPServerConfig } from '@savvagent/mcp-sdk';

/**
 * Splunk configuration options
 */
export interface SplunkConfig {
  /** Splunk host URL (e.g., https://splunk.example.com:8089) */
  host: string;
  /** Splunk authentication token */
  token: string;
  /** Default index to search */
  defaultIndex?: string;
  /** Default sourcetype filter */
  defaultSourcetype?: string;
}

/**
 * Splunk MCP Server
 * Provides tools for querying Splunk log data
 */
export class SplunkMCPServer extends MCPServer {
  private apiClient!: AxiosInstance;
  private splunkConfig: SplunkConfig;

  constructor(config: MCPServerConfig, splunkConfig: SplunkConfig) {
    super(config);
    this.splunkConfig = splunkConfig;
    this.registerSplunkTools();
  }

  /**
   * Initialize the Splunk API client
   */
  async initialize(): Promise<void> {
    this.apiClient = axios.create({
      baseURL: `${this.splunkConfig.host}/services`,
      headers: {
        Authorization: `Bearer ${this.splunkConfig.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    // Verify connection
    try {
      await this.apiClient.get('/server/info', {
        params: { output_mode: 'json' },
      });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to Splunk: ${error}`);
    }
  }

  /**
   * Register Splunk-specific tools
   */
  private registerSplunkTools(): void {
    // search_logs - Search Splunk logs
    this.registerTool(
      'search_logs',
      'Search logs in Splunk using SPL query',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SPL search query (without "search" prefix)',
          },
          time_range: {
            type: 'string',
            description: 'Time range for search',
            enum: ['15m', '1h', '4h', '24h', '7d', '30d'],
            default: '1h',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results',
            minimum: 1,
            maximum: 10000,
            default: 100,
          },
        },
        required: ['query'],
      },
      async (args) => this.searchLogs(args.query, args.time_range || '1h', args.limit || 100)
    );

    // get_errors - Get error logs
    this.registerTool(
      'get_errors',
      'Fetch error-level logs from Splunk',
      {
        type: 'object',
        properties: {
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['15m', '1h', '4h', '24h', '7d'],
            default: '1h',
          },
          index: {
            type: 'string',
            description: 'Splunk index to search',
          },
          sourcetype: {
            type: 'string',
            description: 'Sourcetype filter',
          },
          host: {
            type: 'string',
            description: 'Host filter',
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

    // get_log_patterns - Get log patterns/aggregations
    this.registerTool(
      'get_log_patterns',
      'Get aggregated log patterns and counts',
      {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            description: 'Field to aggregate by (e.g., "source", "host", "status")',
            default: 'source',
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['1h', '4h', '24h', '7d'],
            default: '24h',
          },
          index: {
            type: 'string',
            description: 'Splunk index to search',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of patterns',
            minimum: 1,
            maximum: 100,
            default: 20,
          },
        },
        required: [],
      },
      async (args) => this.getLogPatterns(args)
    );

    // get_anomalies - Detect log anomalies
    this.registerTool(
      'get_anomalies',
      'Detect anomalies in log volume or patterns',
      {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            description: 'Metric to analyze for anomalies',
            enum: ['count', 'error_rate', 'latency'],
            default: 'count',
          },
          time_range: {
            type: 'string',
            description: 'Time range for analysis',
            enum: ['1h', '4h', '24h', '7d'],
            default: '24h',
          },
          index: {
            type: 'string',
            description: 'Splunk index to search',
          },
          threshold: {
            type: 'number',
            description: 'Standard deviation threshold for anomaly detection',
            default: 2,
          },
        },
        required: [],
      },
      async (args) => this.getAnomalies(args)
    );

    // get_saved_searches - List saved searches
    this.registerTool(
      'get_saved_searches',
      'List available saved searches/reports',
      {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Filter saved searches by name pattern',
          },
        },
        required: [],
      },
      async (args) => this.getSavedSearches(args.filter)
    );

    // run_saved_search - Execute a saved search
    this.registerTool(
      'run_saved_search',
      'Execute a saved search and return results',
      {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the saved search',
          },
          time_range: {
            type: 'string',
            description: 'Override time range',
            enum: ['15m', '1h', '4h', '24h', '7d'],
          },
        },
        required: ['name'],
      },
      async (args) => this.runSavedSearch(args.name, args.time_range)
    );

    // get_alerts - Get triggered alerts
    this.registerTool(
      'get_alerts',
      'Get recently triggered alerts',
      {
        type: 'object',
        properties: {
          severity: {
            type: 'string',
            description: 'Filter by severity',
            enum: ['info', 'warn', 'error', 'critical'],
          },
          time_range: {
            type: 'string',
            description: 'Time range for alerts',
            enum: ['1h', '4h', '24h', '7d'],
            default: '24h',
          },
        },
        required: [],
      },
      async (args) => this.getAlerts(args)
    );

    // get_service_health - Get service health from logs
    this.registerTool(
      'get_service_health',
      'Analyze service health based on log patterns',
      {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'Service name or host pattern',
          },
          time_range: {
            type: 'string',
            description: 'Time range for analysis',
            enum: ['15m', '1h', '4h', '24h'],
            default: '1h',
          },
        },
        required: [],
      },
      async (args) => this.getServiceHealth(args)
    );
  }

  /**
   * Convert time range to Splunk format
   */
  private getTimeRange(timeRange: string): { earliest: string; latest: string } {
    const ranges: Record<string, string> = {
      '15m': '-15m',
      '1h': '-1h',
      '4h': '-4h',
      '24h': '-24h',
      '7d': '-7d',
      '30d': '-30d',
    };
    return {
      earliest: ranges[timeRange] || '-1h',
      latest: 'now',
    };
  }

  /**
   * Execute a Splunk search
   */
  private async executeSearch(spl: string, timeRange: string, maxResults: number = 100): Promise<any[]> {
    const { earliest, latest } = this.getTimeRange(timeRange);

    // Create search job
    const createResponse = await this.apiClient.post('/search/jobs',
      `search=search ${spl}&earliest_time=${earliest}&latest_time=${latest}&output_mode=json`,
    );

    const sid = createResponse.data.sid;

    // Wait for search to complete (with timeout)
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      const statusResponse = await this.apiClient.get(`/search/jobs/${sid}`, {
        params: { output_mode: 'json' },
      });

      const state = statusResponse.data.entry?.[0]?.content?.dispatchState;
      if (state === 'DONE' || state === 'FAILED') {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    // Get results
    const resultsResponse = await this.apiClient.get(`/search/jobs/${sid}/results`, {
      params: { output_mode: 'json', count: maxResults },
    });

    return resultsResponse.data.results || [];
  }

  /**
   * Search logs
   */
  private async searchLogs(query: string, timeRange: string, limit: number) {
    const index = this.splunkConfig.defaultIndex ? `index=${this.splunkConfig.defaultIndex} ` : '';
    const sourcetype = this.splunkConfig.defaultSourcetype ? `sourcetype=${this.splunkConfig.defaultSourcetype} ` : '';

    const spl = `${index}${sourcetype}${query} | head ${limit}`;
    const results = await this.executeSearch(spl, timeRange, limit);

    return {
      logs: results.map((r: any) => ({
        _time: r._time,
        _raw: r._raw,
        host: r.host,
        source: r.source,
        sourcetype: r.sourcetype,
        index: r.index,
        ...Object.fromEntries(
          Object.entries(r).filter(([k]) => !k.startsWith('_') && !['host', 'source', 'sourcetype', 'index'].includes(k))
        ),
      })),
      meta: {
        total: results.length,
        query: spl,
        time_range: timeRange,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get error logs
   */
  private async getErrors(args: {
    time_range?: string;
    index?: string;
    sourcetype?: string;
    host?: string;
    limit?: number;
  }) {
    const index = args.index || this.splunkConfig.defaultIndex || '*';
    const filters: string[] = [`index=${index}`];

    if (args.sourcetype || this.splunkConfig.defaultSourcetype) {
      filters.push(`sourcetype=${args.sourcetype || this.splunkConfig.defaultSourcetype}`);
    }
    if (args.host) {
      filters.push(`host=${args.host}`);
    }

    filters.push('(level=error OR level=ERROR OR loglevel=error OR severity=error OR status>=500)');

    const spl = `${filters.join(' ')} | head ${args.limit || 100}`;
    const results = await this.executeSearch(spl, args.time_range || '1h', args.limit || 100);

    return {
      errors: results.map((r: any) => ({
        timestamp: r._time,
        message: r._raw || r.message,
        host: r.host,
        source: r.source,
        level: r.level || r.loglevel || r.severity || 'error',
        index: r.index,
      })),
      meta: {
        total: results.length,
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get log patterns
   */
  private async getLogPatterns(args: {
    field?: string;
    time_range?: string;
    index?: string;
    limit?: number;
  }) {
    const index = args.index || this.splunkConfig.defaultIndex || '*';
    const field = args.field || 'source';

    const spl = `index=${index} | stats count by ${field} | sort -count | head ${args.limit || 20}`;
    const results = await this.executeSearch(spl, args.time_range || '24h', args.limit || 20);

    return {
      patterns: results.map((r: any) => ({
        [field]: r[field],
        count: parseInt(r.count, 10),
      })),
      meta: {
        field,
        total_patterns: results.length,
        time_range: args.time_range || '24h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Detect anomalies
   */
  private async getAnomalies(args: {
    metric?: string;
    time_range?: string;
    index?: string;
    threshold?: number;
  }) {
    const index = args.index || this.splunkConfig.defaultIndex || '*';
    const threshold = args.threshold || 2;

    let spl: string;
    switch (args.metric) {
      case 'error_rate':
        spl = `index=${index} | timechart span=5m count as total, count(eval(level="error" OR status>=500)) as errors | eval error_rate=errors/total*100 | anomalydetection error_rate`;
        break;
      case 'latency':
        spl = `index=${index} | timechart span=5m avg(duration) as avg_latency | anomalydetection avg_latency`;
        break;
      default:
        spl = `index=${index} | timechart span=5m count | anomalydetection count`;
    }

    const results = await this.executeSearch(spl, args.time_range || '24h', 1000);

    const anomalies = results.filter((r: any) => {
      const isAnomaly = r.isAnomaly === '1' || r.isAnomaly === 'true' || parseFloat(r.score || '0') > threshold;
      return isAnomaly;
    });

    return {
      anomalies: anomalies.map((r: any) => ({
        timestamp: r._time,
        metric: args.metric || 'count',
        value: parseFloat(r.count || r.error_rate || r.avg_latency || '0'),
        expected: parseFloat(r.expected || '0'),
        score: parseFloat(r.score || '0'),
      })),
      meta: {
        total_anomalies: anomalies.length,
        metric: args.metric || 'count',
        threshold,
        time_range: args.time_range || '24h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get saved searches
   */
  private async getSavedSearches(filter?: string) {
    const response = await this.apiClient.get('/saved/searches', {
      params: { output_mode: 'json', count: 100 },
    });

    let searches = response.data.entry || [];

    if (filter) {
      const filterLower = filter.toLowerCase();
      searches = searches.filter((s: any) => s.name.toLowerCase().includes(filterLower));
    }

    return {
      saved_searches: searches.map((s: any) => ({
        name: s.name,
        description: s.content?.description,
        search: s.content?.search,
        cron_schedule: s.content?.cron_schedule,
        is_scheduled: s.content?.is_scheduled === '1',
        next_scheduled_time: s.content?.next_scheduled_time,
      })),
      meta: {
        total: searches.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Run a saved search
   */
  private async runSavedSearch(name: string, timeRange?: string) {
    const params: Record<string, string> = { output_mode: 'json' };

    if (timeRange) {
      const { earliest, latest } = this.getTimeRange(timeRange);
      params.earliest_time = earliest;
      params.latest_time = latest;
    }

    const response = await this.apiClient.post(
      `/saved/searches/${encodeURIComponent(name)}/dispatch`,
      Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&'),
    );

    const sid = response.data.sid;

    // Wait for completion
    let attempts = 0;
    while (attempts < 60) {
      const statusResponse = await this.apiClient.get(`/search/jobs/${sid}`, {
        params: { output_mode: 'json' },
      });

      const state = statusResponse.data.entry?.[0]?.content?.dispatchState;
      if (state === 'DONE' || state === 'FAILED') {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    // Get results
    const resultsResponse = await this.apiClient.get(`/search/jobs/${sid}/results`, {
      params: { output_mode: 'json', count: 1000 },
    });

    return {
      name,
      results: resultsResponse.data.results || [],
      meta: {
        total: (resultsResponse.data.results || []).length,
        time_range: timeRange,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get alerts
   */
  private async getAlerts(args: {
    severity?: string;
    time_range?: string;
  }) {
    const response = await this.apiClient.get('/alerts/fired_alerts', {
      params: { output_mode: 'json', count: 100 },
    });

    let alerts = response.data.entry || [];

    if (args.severity) {
      alerts = alerts.filter((a: any) => a.content?.severity === args.severity);
    }

    return {
      alerts: alerts.map((a: any) => ({
        name: a.name,
        trigger_time: a.content?.trigger_time,
        severity: a.content?.severity,
        message: a.content?.message,
        triggered_alerts: a.content?.triggered_alerts,
      })),
      meta: {
        total: alerts.length,
        time_range: args.time_range || '24h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get service health
   */
  private async getServiceHealth(args: {
    service?: string;
    time_range?: string;
  }) {
    const index = this.splunkConfig.defaultIndex || '*';
    const hostFilter = args.service ? `host=*${args.service}*` : '';
    const timeRange = args.time_range || '1h';

    // Get error counts and total counts
    const spl = `index=${index} ${hostFilter} | stats count as total, count(eval(level="error" OR status>=500)) as errors by host | eval error_rate=round(errors/total*100, 2)`;
    const results = await this.executeSearch(spl, timeRange, 100);

    const services = results.map((r: any) => {
      const errorRate = parseFloat(r.error_rate || '0');
      return {
        host: r.host,
        total_events: parseInt(r.total, 10),
        errors: parseInt(r.errors, 10),
        error_rate_percent: errorRate,
        status: errorRate > 5 ? 'critical' : errorRate > 1 ? 'degraded' : 'healthy',
      };
    });

    const totalErrors = services.reduce((sum, s) => sum + s.errors, 0);
    const totalEvents = services.reduce((sum, s) => sum + s.total_events, 0);

    return {
      services,
      summary: {
        total_services: services.length,
        healthy: services.filter(s => s.status === 'healthy').length,
        degraded: services.filter(s => s.status === 'degraded').length,
        critical: services.filter(s => s.status === 'critical').length,
        total_events: totalEvents,
        total_errors: totalErrors,
        overall_error_rate: totalEvents > 0 ? Math.round(totalErrors / totalEvents * 10000) / 100 : 0,
      },
      meta: {
        time_range: timeRange,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.apiClient.get('/server/info', { params: { output_mode: 'json' } });
      return {
        status: 'ok' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          host: this.splunkConfig.host,
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          host: this.splunkConfig.host,
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
