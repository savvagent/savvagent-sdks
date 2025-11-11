/**
 * Savvagent MCP SDK Types
 * Core type definitions for MCP (Model Context Protocol) integrations
 */

/**
 * Flag evaluation event from Savvagent
 */
export interface FlagEvaluation {
  id: string;
  organizationId: string;
  flagId: string;
  flagKey: string;
  result: boolean;
  context?: Record<string, any>;
  durationMs?: number;
  traceId?: string;
  timestamp: string;
}

/**
 * Error event from Savvagent
 */
export interface FlagError {
  id: string;
  organizationId: string;
  flagId: string;
  flagKey: string;
  flagEnabled: boolean;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, any>;
  traceId?: string;
  timestamp: string;
}

/**
 * MCP server configuration
 */
export interface MCPConfig {
  organizationId: string;
  integrationId: string;
  serverType: string;
  config: Record<string, any>;
  enabled: boolean;
}

/**
 * Query parameters for error search
 */
export interface ErrorQuery {
  organizationId: string;
  flagId?: string;
  startTime?: Date;
  endTime?: Date;
  errorType?: string;
  limit?: number;
}

/**
 * External error from MCP provider (e.g., Sentry)
 */
export interface ExternalError {
  id: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  timestamp: string;
  count?: number;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Error correlation result
 */
export interface ErrorCorrelation {
  flagId: string;
  flagKey: string;
  externalError: ExternalError;
  correlationScore: number;
  errorRateBefore: number;
  errorRateAfter: number;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Webhook payload for MCP event
 */
export interface MCPWebhookPayload {
  eventType: 'flag_evaluation' | 'flag_error';
  data: FlagEvaluation | FlagError;
  integrationId: string;
  timestamp: string;
}

/**
 * MCP server health status
 */
export interface MCPHealthStatus {
  healthy: boolean;
  message?: string;
  lastCheck: string;
}
