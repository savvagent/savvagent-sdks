/**
 * Savvagent MCP SDK - API Client
 * Client for communicating with Savvagent backend API
 */

import axios, { AxiosInstance } from 'axios';
import { FlagEvaluation, FlagError, ErrorQuery, ExternalError } from './types';

export interface MCPClientConfig {
  apiUrl: string;
  apiKey: string;
  organizationId: string;
}

/**
 * Client for Savvagent MCP API
 */
export class MCPClient {
  private client: AxiosInstance;
  private config: MCPClientConfig;

  constructor(config: MCPClientConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  }

  /**
   * Send flag evaluation data to Savvagent
   *
   * @param evaluation - Flag evaluation
   */
  async sendEvaluation(evaluation: FlagEvaluation): Promise<void> {
    await this.client.post('/api/mcp/evaluations', evaluation);
  }

  /**
   * Send error data to Savvagent
   *
   * @param error - Error data
   */
  async sendError(error: FlagError): Promise<void> {
    await this.client.post('/api/mcp/errors', error);
  }

  /**
   * Query flag evaluations from Savvagent
   *
   * @param query - Query parameters
   * @returns Array of evaluations
   */
  async queryEvaluations(query: ErrorQuery): Promise<FlagEvaluation[]> {
    const response = await this.client.get('/api/mcp/evaluations', {
      params: query,
    });
    return response.data;
  }

  /**
   * Query errors from Savvagent
   *
   * @param query - Query parameters
   * @returns Array of errors
   */
  async queryErrors(query: ErrorQuery): Promise<FlagError[]> {
    const response = await this.client.get('/api/mcp/errors', {
      params: query,
    });
    return response.data;
  }

  /**
   * Send external errors to Savvagent for correlation
   *
   * @param errors - External errors from observability tool
   */
  async sendExternalErrors(errors: ExternalError[]): Promise<void> {
    await this.client.post('/api/mcp/external-errors', {
      organizationId: this.config.organizationId,
      errors,
    });
  }

  /**
   * Get correlation results for a flag
   *
   * @param flagId - Flag ID
   * @returns Correlation data
   */
  async getCorrelations(flagId: string): Promise<any> {
    const response = await this.client.get(`/api/mcp/correlations/${flagId}`);
    return response.data;
  }
}
