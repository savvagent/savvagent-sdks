/**
 * Savvagent MCP SDK - Webhook Handler
 * Utilities for receiving and processing webhooks from Savvagent
 */

import { MCPWebhookPayload, FlagEvaluation, FlagError } from './types';
import { MCPServer } from './server';

/**
 * Webhook handler for processing Savvagent events
 */
export class MCPWebhookHandler {
  private servers: Map<string, MCPServer> = new Map();

  /**
   * Register an MCP server to handle events
   *
   * @param integrationId - Integration ID from Savvagent
   * @param server - MCP server instance
   */
  registerServer(integrationId: string, server: MCPServer): void {
    this.servers.set(integrationId, server);
  }

  /**
   * Unregister an MCP server
   *
   * @param integrationId - Integration ID
   */
  unregisterServer(integrationId: string): void {
    this.servers.delete(integrationId);
  }

  /**
   * Handle incoming webhook from Savvagent
   *
   * @param payload - Webhook payload
   */
  async handleWebhook(payload: MCPWebhookPayload): Promise<void> {
    const server = this.servers.get(payload.integrationId);

    if (!server) {
      throw new Error(`No server registered for integration: ${payload.integrationId}`);
    }

    if (!server.isInitialized()) {
      throw new Error(`Server not initialized for integration: ${payload.integrationId}`);
    }

    switch (payload.eventType) {
      case 'flag_evaluation':
        await server.onFlagEvaluation(payload.data as FlagEvaluation);
        break;
      case 'flag_error':
        await server.onFlagError(payload.data as FlagError);
        break;
      default:
        throw new Error(`Unknown event type: ${payload.eventType}`);
    }
  }

  /**
   * Validate webhook signature (optional security measure)
   * Override this method to implement signature verification
   *
   * @param payload - Raw webhook payload
   * @param signature - Signature from webhook header
   * @param secret - Webhook secret
   * @returns True if signature is valid
   */
  validateSignature(payload: string, signature: string, secret: string): boolean {
    // Basic implementation - should be overridden with proper HMAC verification
    return signature.length > 0;
  }

  /**
   * Get all registered servers
   */
  getRegisteredServers(): string[] {
    return Array.from(this.servers.keys());
  }
}
