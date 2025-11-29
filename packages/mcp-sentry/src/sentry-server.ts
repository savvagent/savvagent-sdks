/**
 * Savvagent Sentry MCP Server
 * Pull-based MCP server that exposes Sentry error data via JSON-RPC 2.0 tools
 */

import axios, { AxiosInstance } from 'axios';
import { MCPServer, MCPServerConfig } from '@savvagent/mcp-sdk';

/**
 * Sentry configuration options
 */
export interface SentryConfig {
  /** Sentry API authentication token */
  authToken: string;
  /** Sentry organization slug */
  organization: string;
  /** Sentry project slug */
  project: string;
  /** Environment filter (optional) */
  environment?: string;
  /** Sentry API base URL (default: https://sentry.io/api/0) */
  apiUrl?: string;
}

/**
 * Sentry MCP Server
 * Provides tools for querying Sentry error data
 */
export class SentryMCPServer extends MCPServer {
  private apiClient!: AxiosInstance;
  private sentryConfig: SentryConfig;

  constructor(config: MCPServerConfig, sentryConfig: SentryConfig) {
    super(config);
    this.sentryConfig = sentryConfig;
    this.registerSentryTools();
  }

  /**
   * Initialize the Sentry API client
   */
  async initialize(): Promise<void> {
    this.apiClient = axios.create({
      baseURL: this.sentryConfig.apiUrl || 'https://sentry.io/api/0',
      headers: {
        Authorization: `Bearer ${this.sentryConfig.authToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Verify connection
    try {
      await this.apiClient.get(`/organizations/${this.sentryConfig.organization}/`);
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to connect to Sentry: ${error}`);
    }
  }

  /**
   * Register Sentry-specific tools
   */
  private registerSentryTools(): void {
    // get_errors - Fetch recent errors
    this.registerTool(
      'get_errors',
      'Fetch recent error events from Sentry with counts and metadata',
      {
        type: 'object',
        properties: {
          time_range: {
            type: 'string',
            description: 'Time range for query',
            enum: ['1h', '24h', '7d', '14d', '30d'],
            default: '24h',
          },
          environment: {
            type: 'string',
            description: 'Environment filter (e.g., production, staging)',
          },
          severity: {
            type: 'string',
            description: 'Minimum severity level',
            enum: ['debug', 'info', 'warning', 'error', 'fatal'],
            default: 'error',
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
      async (args) => this.getErrors(args)
    );

    // get_error_details - Get detailed error info
    this.registerTool(
      'get_error_details',
      'Get detailed information about a specific Sentry issue including stack trace',
      {
        type: 'object',
        properties: {
          issue_id: {
            type: 'string',
            description: 'The Sentry issue ID',
          },
        },
        required: ['issue_id'],
      },
      async (args) => this.getErrorDetails(args.issue_id)
    );

    // get_error_events - Get recent events for an issue
    this.registerTool(
      'get_error_events',
      'Get recent event occurrences for a specific Sentry issue',
      {
        type: 'object',
        properties: {
          issue_id: {
            type: 'string',
            description: 'The Sentry issue ID',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of events',
            minimum: 1,
            maximum: 100,
            default: 20,
          },
        },
        required: ['issue_id'],
      },
      async (args) => this.getErrorEvents(args.issue_id, args.limit || 20)
    );

    // search_errors - Search errors by query
    this.registerTool(
      'search_errors',
      'Search Sentry issues by message, tag, or other criteria',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "is:unresolved TypeError")',
          },
          time_range: {
            type: 'string',
            description: 'Time range for search',
            enum: ['1h', '24h', '7d', '14d', '30d'],
            default: '7d',
          },
          limit: {
            type: 'integer',
            description: 'Maximum results',
            minimum: 1,
            maximum: 100,
            default: 25,
          },
        },
        required: ['query'],
      },
      async (args) => this.searchErrors(args.query, args.time_range || '7d', args.limit || 25)
    );

    // get_service_health - Get project health overview
    this.registerTool(
      'get_service_health',
      'Get health overview and statistics for the Sentry project',
      {
        type: 'object',
        properties: {
          time_range: {
            type: 'string',
            description: 'Time range for statistics',
            enum: ['1h', '24h', '7d'],
            default: '24h',
          },
        },
        required: [],
      },
      async (args) => this.getServiceHealth(args.time_range || '24h')
    );
  }

  /**
   * Get recent errors from Sentry
   */
  private async getErrors(args: {
    time_range?: string;
    environment?: string;
    severity?: string;
    limit?: number;
  }) {
    const { organization, project } = this.sentryConfig;
    const timeRange = args.time_range || '24h';
    const limit = args.limit || 50;

    const params: Record<string, string> = {
      project: project,
      statsPeriod: timeRange,
      per_page: String(limit),
      query: 'is:unresolved',
    };

    if (args.environment || this.sentryConfig.environment) {
      params.environment = args.environment || this.sentryConfig.environment!;
    }

    if (args.severity) {
      params.query += ` level:${args.severity}`;
    }

    const response = await this.apiClient.get(`/organizations/${organization}/issues/`, {
      params,
    });

    const issues = response.data;

    return {
      errors: issues.map((issue: any) => ({
        id: issue.id,
        short_id: issue.shortId,
        title: issue.title,
        culprit: issue.culprit,
        count: issue.count,
        user_count: issue.userCount,
        first_seen: issue.firstSeen,
        last_seen: issue.lastSeen,
        level: issue.level,
        status: issue.status,
        is_unhandled: issue.isUnhandled,
        permalink: issue.permalink,
        metadata: {
          type: issue.metadata?.type,
          value: issue.metadata?.value,
          filename: issue.metadata?.filename,
          function: issue.metadata?.function,
        },
      })),
      meta: {
        total: issues.length,
        time_range: timeRange,
        project: project,
        organization: organization,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get detailed error information
   */
  private async getErrorDetails(issueId: string) {
    const { organization } = this.sentryConfig;

    const [issueResponse, latestEventResponse] = await Promise.all([
      this.apiClient.get(`/organizations/${organization}/issues/${issueId}/`),
      this.apiClient.get(`/organizations/${organization}/issues/${issueId}/events/latest/`).catch(() => null),
    ]);

    const issue = issueResponse.data;
    const latestEvent = latestEventResponse?.data;

    return {
      id: issue.id,
      short_id: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      count: issue.count,
      user_count: issue.userCount,
      first_seen: issue.firstSeen,
      last_seen: issue.lastSeen,
      level: issue.level,
      status: issue.status,
      is_unhandled: issue.isUnhandled,
      permalink: issue.permalink,
      tags: issue.tags?.map((tag: any) => ({
        key: tag.key,
        value: tag.value,
        count: tag.count,
      })),
      latest_event: latestEvent
        ? {
            id: latestEvent.eventID,
            timestamp: latestEvent.dateCreated,
            message: latestEvent.message,
            platform: latestEvent.platform,
            contexts: latestEvent.contexts,
            exception: latestEvent.entries?.find((e: any) => e.type === 'exception')?.data,
            breadcrumbs: latestEvent.entries?.find((e: any) => e.type === 'breadcrumbs')?.data?.values?.slice(-10),
            request: latestEvent.entries?.find((e: any) => e.type === 'request')?.data,
          }
        : null,
    };
  }

  /**
   * Get recent events for an issue
   */
  private async getErrorEvents(issueId: string, limit: number) {
    const { organization } = this.sentryConfig;

    const response = await this.apiClient.get(
      `/organizations/${organization}/issues/${issueId}/events/`,
      { params: { per_page: limit } }
    );

    return {
      issue_id: issueId,
      events: response.data.map((event: any) => ({
        id: event.eventID,
        timestamp: event.dateCreated,
        message: event.message,
        platform: event.platform,
        user: event.user,
        tags: event.tags,
        context: event.context,
      })),
      total: response.data.length,
    };
  }

  /**
   * Search errors by query
   */
  private async searchErrors(query: string, timeRange: string, limit: number) {
    const { organization, project } = this.sentryConfig;

    const response = await this.apiClient.get(`/organizations/${organization}/issues/`, {
      params: {
        project,
        statsPeriod: timeRange,
        per_page: limit,
        query,
      },
    });

    return {
      query,
      time_range: timeRange,
      results: response.data.map((issue: any) => ({
        id: issue.id,
        short_id: issue.shortId,
        title: issue.title,
        count: issue.count,
        last_seen: issue.lastSeen,
        level: issue.level,
        status: issue.status,
        permalink: issue.permalink,
      })),
      total: response.data.length,
    };
  }

  /**
   * Get service health overview
   */
  private async getServiceHealth(timeRange: string) {
    const { organization, project } = this.sentryConfig;

    // Get issue stats
    const [issuesResponse, statsResponse] = await Promise.all([
      this.apiClient.get(`/organizations/${organization}/issues/`, {
        params: {
          project,
          statsPeriod: timeRange,
          query: 'is:unresolved',
          per_page: '100',
        },
      }),
      this.apiClient
        .get(`/projects/${organization}/${project}/stats/`, {
          params: { stat: 'received', resolution: '1h' },
        })
        .catch(() => null),
    ]);

    const issues = issuesResponse.data;
    const stats = statsResponse?.data || [];

    const errorCount = issues.reduce((sum: number, issue: any) => sum + (issue.count || 0), 0);
    const fatalErrors = issues.filter((i: any) => i.level === 'fatal').length;
    const unresolvedCount = issues.filter((i: any) => i.status === 'unresolved').length;

    return {
      project: project,
      organization: organization,
      time_range: timeRange,
      summary: {
        total_issues: issues.length,
        unresolved_issues: unresolvedCount,
        total_error_count: errorCount,
        fatal_errors: fatalErrors,
        status: fatalErrors > 0 ? 'critical' : unresolvedCount > 10 ? 'degraded' : 'healthy',
      },
      severity_breakdown: {
        fatal: issues.filter((i: any) => i.level === 'fatal').length,
        error: issues.filter((i: any) => i.level === 'error').length,
        warning: issues.filter((i: any) => i.level === 'warning').length,
        info: issues.filter((i: any) => i.level === 'info').length,
      },
      top_issues: issues.slice(0, 5).map((issue: any) => ({
        id: issue.id,
        title: issue.title,
        count: issue.count,
        last_seen: issue.lastSeen,
      })),
      event_volume: stats.slice(-24).map((point: any) => ({
        timestamp: new Date(point[0] * 1000).toISOString(),
        count: point[1],
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Health check - verify Sentry connection
   */
  async healthCheck() {
    try {
      await this.apiClient.get(`/organizations/${this.sentryConfig.organization}/`);
      return {
        status: 'ok' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          organization: this.sentryConfig.organization,
          project: this.sentryConfig.project,
          connected: true,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        version: this.config.version,
        timestamp: new Date().toISOString(),
        details: {
          organization: this.sentryConfig.organization,
          project: this.sentryConfig.project,
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
