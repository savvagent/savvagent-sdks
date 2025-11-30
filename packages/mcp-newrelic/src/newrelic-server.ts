/**
 * Savvagent New Relic MCP Server
 * Pull-based MCP server that exposes New Relic APM and monitoring data via JSON-RPC 2.0 tools
 */

import axios, { AxiosInstance } from 'axios';
import { MCPServer, MCPServerConfig } from '@savvagent/mcp-sdk';

/**
 * New Relic configuration options
 */
export interface NewRelicConfig {
  /** New Relic API key (User API key) */
  apiKey: string;
  /** New Relic Account ID */
  accountId: string;
  /** New Relic region (US or EU) */
  region?: 'US' | 'EU';
}

/**
 * New Relic MCP Server
 */
export class NewRelicMCPServer extends MCPServer {
  private apiClient!: AxiosInstance;
  private nerdGraphClient!: AxiosInstance;
  private newRelicConfig: NewRelicConfig;

  constructor(config: MCPServerConfig, newRelicConfig: NewRelicConfig) {
    super(config);
    this.newRelicConfig = newRelicConfig;
    this.registerNewRelicTools();
  }

  async initialize(): Promise<void> {
    const isEU = this.newRelicConfig.region === 'EU';
    const apiBase = isEU ? 'https://api.eu.newrelic.com' : 'https://api.newrelic.com';
    const nerdGraphBase = isEU ? 'https://api.eu.newrelic.com/graphql' : 'https://api.newrelic.com/graphql';

    this.apiClient = axios.create({
      baseURL: apiBase,
      headers: {
        'Api-Key': this.newRelicConfig.apiKey,
        'Content-Type': 'application/json',
      },
    });

    this.nerdGraphClient = axios.create({
      baseURL: nerdGraphBase,
      headers: {
        'Api-Key': this.newRelicConfig.apiKey,
        'Content-Type': 'application/json',
      },
    });

    try {
      await this.executeNrql('SELECT count(*) FROM Transaction SINCE 1 minute ago');
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to New Relic: ${error}`);
    }
  }

  private registerNewRelicTools(): void {
    // get_errors - Get APM errors
    this.registerTool(
      'get_errors',
      'Get APM error events from New Relic',
      {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description: 'Application name filter',
          },
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['15m', '1h', '6h', '24h', '7d'],
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
        required: [],
      },
      async (args) => this.getErrors(args)
    );

    // run_nrql - Execute NRQL query
    this.registerTool(
      'run_nrql',
      'Execute a NRQL query against New Relic data',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'NRQL query to execute',
          },
        },
        required: ['query'],
      },
      async (args) => this.runNrql(args.query)
    );

    // get_apm_metrics - Get APM metrics
    this.registerTool(
      'get_apm_metrics',
      'Get APM metrics for an application',
      {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description: 'Application name',
          },
          metrics: {
            type: 'string',
            description: 'Comma-separated metric names',
            default: 'Apdex,HttpDispatcher,Errors/all',
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['15m', '1h', '6h', '24h', '7d'],
            default: '1h',
          },
        },
        required: ['app_name'],
      },
      async (args) => this.getApmMetrics(args as { app_name: string; metrics?: string; time_range?: string })
    );

    // get_applications - List APM applications
    this.registerTool(
      'get_applications',
      'List APM applications',
      {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Filter applications by name pattern',
          },
        },
        required: [],
      },
      async (args) => this.getApplications(args.filter)
    );

    // get_alerts - Get alert incidents
    this.registerTool(
      'get_alerts',
      'Get alert incidents and violations',
      {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status',
            enum: ['open', 'closed'],
          },
          priority: {
            type: 'string',
            description: 'Filter by priority',
            enum: ['critical', 'warning'],
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['1h', '6h', '24h', '7d', '30d'],
            default: '24h',
          },
        },
        required: [],
      },
      async (args) => this.getAlerts(args)
    );

    // get_transactions - Get transaction data
    this.registerTool(
      'get_transactions',
      'Get transaction performance data',
      {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description: 'Application name',
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['15m', '1h', '6h', '24h'],
            default: '1h',
          },
          limit: {
            type: 'integer',
            description: 'Maximum results',
            minimum: 1,
            maximum: 100,
            default: 20,
          },
        },
        required: [],
      },
      async (args) => this.getTransactions(args)
    );

    // get_infrastructure - Get infrastructure metrics
    this.registerTool(
      'get_infrastructure',
      'Get infrastructure host metrics',
      {
        type: 'object',
        properties: {
          host_filter: {
            type: 'string',
            description: 'Filter hosts by name pattern',
          },
          time_range: {
            type: 'string',
            description: 'Time range',
            enum: ['15m', '1h', '6h', '24h'],
            default: '1h',
          },
        },
        required: [],
      },
      async (args) => this.getInfrastructure(args)
    );

    // get_synthetics - Get synthetic monitor results
    this.registerTool(
      'get_synthetics',
      'Get synthetic monitoring results',
      {
        type: 'object',
        properties: {
          monitor_name: {
            type: 'string',
            description: 'Filter by monitor name',
          },
          status: {
            type: 'string',
            description: 'Filter by status',
            enum: ['SUCCESS', 'FAILED'],
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
      async (args) => this.getSynthetics(args)
    );

    // get_service_health - Get overall service health
    this.registerTool(
      'get_service_health',
      'Get health overview of APM applications',
      {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description: 'Specific application name (optional)',
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
  }

  private getTimeRangeSince(timeRange: string): string {
    const ranges: Record<string, string> = {
      '15m': '15 minutes ago',
      '1h': '1 hour ago',
      '6h': '6 hours ago',
      '24h': '24 hours ago',
      '7d': '7 days ago',
      '30d': '30 days ago',
    };
    return ranges[timeRange] || '1 hour ago';
  }

  private async executeNrql(query: string): Promise<any> {
    const graphqlQuery = `
      {
        actor {
          account(id: ${this.newRelicConfig.accountId}) {
            nrql(query: "${query.replace(/"/g, '\\"')}") {
              results
            }
          }
        }
      }
    `;

    const response = await this.nerdGraphClient.post('', { query: graphqlQuery });

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    return response.data.data.actor.account.nrql.results;
  }

  private async getErrors(args: { app_name?: string; time_range?: string; limit?: number }) {
    const since = this.getTimeRangeSince(args.time_range || '1h');
    const appFilter = args.app_name ? `WHERE appName = '${args.app_name}'` : '';
    const limit = args.limit || 100;

    const query = `SELECT * FROM TransactionError ${appFilter} SINCE ${since} LIMIT ${limit}`;
    const results = await this.executeNrql(query);

    return {
      errors: results.map((r: any) => ({
        timestamp: r.timestamp,
        app_name: r.appName,
        error_class: r['error.class'],
        error_message: r['error.message'],
        transaction_name: r.transactionName,
        host: r.host,
        request_uri: r.request_uri,
      })),
      meta: {
        total: results.length,
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async runNrql(query: string) {
    const results = await this.executeNrql(query);

    return {
      query,
      results,
      meta: {
        total: results.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getApmMetrics(args: { app_name: string; metrics?: string; time_range?: string }) {
    const since = this.getTimeRangeSince(args.time_range || '1h');

    // Get throughput, response time, and error rate
    const queries = [
      `SELECT rate(count(*), 1 minute) as 'rpm' FROM Transaction WHERE appName = '${args.app_name}' SINCE ${since} TIMESERIES`,
      `SELECT average(duration) as 'avg_duration' FROM Transaction WHERE appName = '${args.app_name}' SINCE ${since} TIMESERIES`,
      `SELECT percentage(count(*), WHERE error IS true) as 'error_rate' FROM Transaction WHERE appName = '${args.app_name}' SINCE ${since} TIMESERIES`,
    ];

    const [throughput, duration, errorRate] = await Promise.all(
      queries.map(q => this.executeNrql(q).catch(() => []))
    );

    return {
      app_name: args.app_name,
      metrics: {
        throughput: throughput.map((r: any) => ({
          timestamp: r.beginTimeSeconds ? new Date(r.beginTimeSeconds * 1000).toISOString() : null,
          value: r.rpm,
        })),
        avg_response_time_ms: duration.map((r: any) => ({
          timestamp: r.beginTimeSeconds ? new Date(r.beginTimeSeconds * 1000).toISOString() : null,
          value: r.avg_duration ? r.avg_duration * 1000 : null,
        })),
        error_rate: errorRate.map((r: any) => ({
          timestamp: r.beginTimeSeconds ? new Date(r.beginTimeSeconds * 1000).toISOString() : null,
          value: r.error_rate,
        })),
      },
      meta: {
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getApplications(filter?: string) {
    const query = filter
      ? `SELECT uniques(appName) FROM Transaction WHERE appName LIKE '%${filter}%' SINCE 24 hours ago`
      : `SELECT uniques(appName) FROM Transaction SINCE 24 hours ago`;

    const results = await this.executeNrql(query);
    const appNames = results[0]?.['uniques.appName'] || [];

    // Get health for each app
    const apps = await Promise.all(
      appNames.slice(0, 50).map(async (appName: string) => {
        try {
          const healthQuery = `SELECT count(*), percentage(count(*), WHERE error IS true) as errorRate FROM Transaction WHERE appName = '${appName}' SINCE 1 hour ago`;
          const healthResult = await this.executeNrql(healthQuery);

          return {
            name: appName,
            transaction_count: healthResult[0]?.count || 0,
            error_rate: healthResult[0]?.errorRate || 0,
            status: (healthResult[0]?.errorRate || 0) > 5 ? 'critical' : (healthResult[0]?.errorRate || 0) > 1 ? 'degraded' : 'healthy',
          };
        } catch {
          return { name: appName, status: 'unknown' };
        }
      })
    );

    return {
      applications: apps,
      meta: {
        total: apps.length,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getAlerts(args: { status?: string; priority?: string; time_range?: string }) {
    const since = this.getTimeRangeSince(args.time_range || '24h');

    let whereClause = '';
    if (args.status) {
      whereClause += ` AND event = '${args.status === 'open' ? 'open' : 'close'}'`;
    }
    if (args.priority) {
      whereClause += ` AND priority = '${args.priority}'`;
    }

    const query = `SELECT * FROM NrAiIncident WHERE 1=1 ${whereClause} SINCE ${since} LIMIT 100`;

    try {
      const results = await this.executeNrql(query);

      return {
        incidents: results.map((r: any) => ({
          id: r.incidentId,
          title: r.title,
          priority: r.priority,
          state: r.state,
          opened_at: r.openTime ? new Date(r.openTime).toISOString() : null,
          closed_at: r.closeTime ? new Date(r.closeTime).toISOString() : null,
          condition_name: r.conditionName,
          policy_name: r.policyName,
        })),
        meta: {
          total: results.length,
          time_range: args.time_range || '24h',
          timestamp: new Date().toISOString(),
        },
      };
    } catch {
      return {
        incidents: [],
        meta: {
          total: 0,
          time_range: args.time_range || '24h',
          timestamp: new Date().toISOString(),
          note: 'No incidents found or alerts not configured',
        },
      };
    }
  }

  private async getTransactions(args: { app_name?: string; time_range?: string; limit?: number }) {
    const since = this.getTimeRangeSince(args.time_range || '1h');
    const appFilter = args.app_name ? `WHERE appName = '${args.app_name}'` : '';
    const limit = args.limit || 20;

    const query = `SELECT count(*), average(duration), percentile(duration, 95) FROM Transaction ${appFilter} SINCE ${since} FACET name LIMIT ${limit}`;
    const results = await this.executeNrql(query);

    return {
      transactions: results.map((r: any) => ({
        name: r.facet,
        count: r.count,
        avg_duration_ms: r['average.duration'] ? r['average.duration'] * 1000 : null,
        p95_duration_ms: r['percentile.duration'] ? r['percentile.duration'] * 1000 : null,
      })),
      meta: {
        total: results.length,
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getInfrastructure(args: { host_filter?: string; time_range?: string }) {
    const since = this.getTimeRangeSince(args.time_range || '1h');
    const hostFilter = args.host_filter ? `WHERE hostname LIKE '%${args.host_filter}%'` : '';

    const query = `SELECT average(cpuPercent), average(memoryUsedPercent), average(diskUsedPercent) FROM SystemSample ${hostFilter} SINCE ${since} FACET hostname LIMIT 50`;
    const results = await this.executeNrql(query);

    return {
      hosts: results.map((r: any) => ({
        hostname: r.facet,
        cpu_percent: r['average.cpuPercent'],
        memory_percent: r['average.memoryUsedPercent'],
        disk_percent: r['average.diskUsedPercent'],
        status: (r['average.cpuPercent'] > 90 || r['average.memoryUsedPercent'] > 90) ? 'critical' : 'healthy',
      })),
      meta: {
        total: results.length,
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getSynthetics(args: { monitor_name?: string; status?: string; time_range?: string }) {
    const since = this.getTimeRangeSince(args.time_range || '24h');
    let whereClause = '';

    if (args.monitor_name) {
      whereClause += ` AND monitorName LIKE '%${args.monitor_name}%'`;
    }
    if (args.status) {
      whereClause += ` AND result = '${args.status}'`;
    }

    const query = `SELECT count(*), percentage(count(*), WHERE result = 'SUCCESS') as successRate FROM SyntheticCheck WHERE 1=1 ${whereClause} SINCE ${since} FACET monitorName LIMIT 50`;
    const results = await this.executeNrql(query);

    return {
      monitors: results.map((r: any) => ({
        name: r.facet,
        check_count: r.count,
        success_rate: r.successRate,
        status: r.successRate >= 99 ? 'healthy' : r.successRate >= 95 ? 'degraded' : 'critical',
      })),
      meta: {
        total: results.length,
        time_range: args.time_range || '24h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async getServiceHealth(args: { app_name?: string; time_range?: string }) {
    const since = this.getTimeRangeSince(args.time_range || '1h');
    const appFilter = args.app_name ? `WHERE appName = '${args.app_name}'` : '';

    const query = `SELECT count(*), percentage(count(*), WHERE error IS true) as errorRate, average(duration) FROM Transaction ${appFilter} SINCE ${since} FACET appName LIMIT 50`;
    const results = await this.executeNrql(query);

    const services = results.map((r: any) => {
      const errorRate = r.errorRate || 0;
      return {
        name: r.facet as string,
        transaction_count: r.count as number,
        error_rate_percent: Math.round(errorRate * 100) / 100,
        avg_response_time_ms: r['average.duration'] ? Math.round(r['average.duration'] * 1000 * 100) / 100 : null,
        status: (errorRate > 5 ? 'critical' : errorRate > 1 ? 'degraded' : 'healthy') as 'critical' | 'degraded' | 'healthy',
      };
    });

    return {
      services,
      summary: {
        total: services.length,
        healthy: services.filter((s: { status: string }) => s.status === 'healthy').length,
        degraded: services.filter((s: { status: string }) => s.status === 'degraded').length,
        critical: services.filter((s: { status: string }) => s.status === 'critical').length,
      },
      meta: {
        time_range: args.time_range || '1h',
        timestamp: new Date().toISOString(),
      },
    };
  }

  async healthCheck() {
    try {
      await this.executeNrql('SELECT count(*) FROM Transaction SINCE 1 minute ago');
      return {
        status: 'ok' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          accountId: this.newRelicConfig.accountId,
          region: this.newRelicConfig.region || 'US',
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          accountId: this.newRelicConfig.accountId,
          region: this.newRelicConfig.region || 'US',
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
