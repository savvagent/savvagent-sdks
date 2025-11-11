/**
 * Savvagent Sentry MCP Server
 * Integrates Savvagent feature flags with Sentry error tracking
 */

import * as Sentry from '@sentry/node';
import axios, { AxiosInstance } from 'axios';
import {
  MCPServer,
  FlagEvaluation,
  FlagError,
  ErrorQuery,
  ExternalError,
  MCPConfig,
} from '@savvagent/mcp-sdk';

export interface SentryConfig {
  dsn: string;
  authToken: string;
  organization: string;
  project: string;
  environment?: string;
}

/**
 * Sentry MCP Server
 * Connects Savvagent with Sentry for error correlation
 */
export class SentryMCPServer extends MCPServer {
  private sentryClient!: typeof Sentry;
  private apiClient!: AxiosInstance;
  private sentryConfig!: SentryConfig;

  constructor(config: MCPConfig) {
    super(config);
    this.sentryConfig = config.config as SentryConfig;
  }

  /**
   * Initialize Sentry client and API client
   */
  async initialize(): Promise<void> {
    // Initialize Sentry SDK
    Sentry.init({
      dsn: this.sentryConfig.dsn,
      environment: this.sentryConfig.environment || 'production',
      tracesSampleRate: 1.0,
    });

    this.sentryClient = Sentry;

    // Initialize Sentry API client
    this.apiClient = axios.create({
      baseURL: 'https://sentry.io/api/0',
      headers: {
        Authorization: `Bearer ${this.sentryConfig.authToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.initialized = true;
    console.log('[SentryMCP] Initialized successfully');
  }

  /**
   * Handle flag evaluation - add as breadcrumb to Sentry
   */
  async onFlagEvaluation(evaluation: FlagEvaluation): Promise<void> {
    if (!this.initialized) {
      throw new Error('Server not initialized');
    }

    // Add breadcrumb to Sentry
    this.sentryClient.addBreadcrumb({
      category: 'feature-flag',
      message: `Flag "${evaluation.flagKey}" evaluated to ${evaluation.result}`,
      level: 'info',
      data: {
        flag_key: evaluation.flagKey,
        flag_id: evaluation.flagId,
        result: evaluation.result,
        trace_id: evaluation.traceId,
        context: evaluation.context,
      },
      timestamp: new Date(evaluation.timestamp).getTime() / 1000,
    });

    console.log(`[SentryMCP] Added breadcrumb for flag: ${evaluation.flagKey} = ${evaluation.result}`);
  }

  /**
   * Handle flag error - capture error with flag context
   */
  async onFlagError(error: FlagError): Promise<void> {
    if (!this.initialized) {
      throw new Error('Server not initialized');
    }

    // Capture exception with flag context
    this.sentryClient.captureException(new Error(error.errorMessage), {
      tags: {
        flag_key: error.flagKey,
        flag_id: error.flagId,
        flag_enabled: String(error.flagEnabled),
        error_type: error.errorType,
      },
      contexts: {
        'feature-flag': {
          key: error.flagKey,
          id: error.flagId,
          enabled: error.flagEnabled,
        },
      },
      extra: {
        ...error.context,
        trace_id: error.traceId,
        stack_trace: error.stackTrace,
      },
      level: 'error',
    });

    console.log(`[SentryMCP] Captured error for flag: ${error.flagKey} (${error.errorType})`);
  }

  /**
   * Query errors from Sentry
   */
  async queryErrors(query: ErrorQuery): Promise<ExternalError[]> {
    if (!this.initialized) {
      throw new Error('Server not initialized');
    }

    try {
      const { organization, project } = this.sentryConfig;

      // Build query parameters
      const params: any = {
        project: project,
        statsPeriod: '24h',
      };

      if (query.startTime && query.endTime) {
        params.start = query.startTime.toISOString();
        params.end = query.endTime.toISOString();
      }

      if (query.limit) {
        params.per_page = query.limit;
      }

      // Query Sentry issues
      const response = await this.apiClient.get(
        `/organizations/${organization}/issues/`,
        { params }
      );

      const issues = response.data;

      // Transform Sentry issues to ExternalError format
      const errors: ExternalError[] = issues.map((issue: any) => ({
        id: issue.id,
        errorType: issue.type || issue.metadata?.type || 'Error',
        errorMessage: issue.title || issue.culprit,
        stackTrace: issue.metadata?.value || undefined,
        timestamp: issue.lastSeen || issue.firstSeen,
        count: issue.count || 1,
        tags: {
          level: issue.level,
          status: issue.status,
          ...this.extractFlagTags(issue.tags),
        },
        metadata: {
          permalink: issue.permalink,
          shortId: issue.shortId,
          status: issue.status,
          isUnhandled: issue.isUnhandled,
        },
      }));

      console.log(`[SentryMCP] Queried ${errors.length} errors from Sentry`);
      return errors;

    } catch (error) {
      console.error('[SentryMCP] Error querying Sentry:', error);
      throw error;
    }
  }

  /**
   * Extract flag-related tags from Sentry issue
   */
  private extractFlagTags(tags: any[]): Record<string, string> {
    const flagTags: Record<string, string> = {};

    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (tag.key && tag.key.startsWith('flag_')) {
          flagTags[tag.key] = tag.value;
        }
      }
    }

    return flagTags;
  }

  /**
   * Health check - verify Sentry connection
   */
  async healthCheck() {
    try {
      const { organization } = this.sentryConfig;
      await this.apiClient.get(`/organizations/${organization}/`);

      return {
        healthy: true,
        message: 'Sentry connection healthy',
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Sentry connection failed: ${error}`,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Shutdown - flush Sentry and close connections
   */
  async shutdown(): Promise<void> {
    if (this.sentryClient) {
      await this.sentryClient.close(2000);
    }
    await super.shutdown();
    console.log('[SentryMCP] Shutdown complete');
  }
}
